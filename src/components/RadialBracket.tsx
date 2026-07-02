"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import useSWR from "swr";
import Flag from "./Flag";
import Broadcaster from "./Broadcaster";
import { countdown, kickoff, countdownDetailed } from "@/lib/time";

interface Scorer {
  player: string;
  minute: string;
  own: boolean;
}
const scorersFetcher = (u: string) => fetch(u).then((r) => r.json());

interface BTeam {
  code: string | null;
  name: string;
  flag: string;
  placeholder: string;
  score: number | null;
  pens: number | null;
  winner: boolean;
  lost?: boolean;
  provisional?: boolean;
}
interface BMatch {
  matchId: string;
  slot: string;
  nextSlot: string | null;
  stage: string;
  status: string;
  minute: number | null;
  utcDate: string;
  venue: string;
  home: BTeam;
  away: BTeam;
}

const STAGE_ES: Record<string, string> = {
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos",
  QUARTER_FINALS: "Cuartos de final",
  SEMI_FINALS: "Semifinal",
  THIRD_PLACE: "Tercer puesto",
  FINAL: "Final",
};
// Badge tipo notificación: nº de "ava" de final (16° dieciseisavos ... F final).
const STAGE_BADGE: Record<string, string> = {
  LAST_32: "16°",
  LAST_16: "8°",
  QUARTER_FINALS: "4°",
  SEMI_FINALS: "2°",
  THIRD_PLACE: "3º",
  FINAL: "F",
};

function statusLabel(m: BMatch): string {
  if (m.status === "LIVE" || m.status === "PAUSED")
    return `🔴 En vivo · ${m.minute ?? 0}'`;
  if (m.status === "FINISHED") return "Finalizado";
  const cd = countdown(m.utcDate);
  const k = kickoff(m.utcDate);
  return [k, cd].filter(Boolean).join(" · ") || "Por jugar";
}
interface Round {
  stage: string;
  title: string;
  matches: BMatch[];
}

interface Node {
  slot: string;
  nextSlot: string | null;
  x: number;
  y: number;
  round: number; // 0 = anillo exterior (R32) ... 4 = final (centro)
  live: boolean;
  done: boolean;
  below: boolean; // tooltip debajo (nodo en la mitad superior)
  m: BMatch;
}

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
// Radio relativo de cada ronda (exterior -> centro). Las semifinales se alejan
// del centro para no encimarse con la caja de la final.
const RING = [1.0, 0.78, 0.56, 0.38, 0.0];

// ---------- WebGL helpers ----------
function makeProgram(gl: WebGLRenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  return p;
}

const EDGE_VS = `
attribute vec2 a_pos;
attribute float a_along;
attribute float a_side;
attribute float a_live;
attribute float a_anim;
attribute float a_dim;
uniform vec2 u_res;
varying float v_along; varying float v_side; varying float v_live; varying float v_anim; varying float v_dim;
void main(){
  v_along=a_along; v_side=a_side; v_live=a_live; v_anim=a_anim; v_dim=a_dim;
  vec2 clip = vec2(a_pos.x/u_res.x*2.0-1.0, 1.0-a_pos.y/u_res.y*2.0);
  gl_Position = vec4(clip,0.0,1.0);
}`;
const EDGE_FS = `
precision highp float;
uniform float u_time;
varying float v_along; varying float v_side; varying float v_live; varying float v_anim; varying float v_dim;
void main(){
  float across = 1.0 - abs(v_side);
  float core = smoothstep(0.0,1.0,across);
  // Partido hijo sin equipos aún -> conector muy atenuado (no compite con las cajas).
  float dimF = v_dim > 0.5 ? 0.28 : 1.0;
  if(v_anim < 0.5){
    // RESUELTO (pasado): línea estática verde, sin animación.
    vec3 col = vec3(0.0,0.60,0.44);
    float a = core*0.42*dimF;
    gl_FragColor = vec4(col*a, a);
    return;
  }
  // FUTURO / EN VIVO: pulso de energía fluyendo hacia el centro.
  float flow = 0.5 + 0.5*sin((v_along*18.0) + u_time*(2.5 + v_live*3.5));
  vec3 col = mix(vec3(0.12,0.42,0.95), vec3(0.35,0.62,1.0), flow); // futuro (azul)
  if(v_live>0.5) col = mix(vec3(0.7,0.10,0.24), vec3(1.0,0.30,0.44), flow); // en vivo (rojo)
  float a = core*(0.20 + 0.60*flow)*dimF;
  gl_FragColor = vec4(col*a, a);
}`;

const NODE_VS = `
attribute vec2 a_pos;
attribute vec2 a_corner;
attribute float a_size;
attribute float a_state;
uniform vec2 u_res;
varying vec2 v_corner; varying float v_state;
void main(){
  v_corner=a_corner; v_state=a_state;
  vec2 p = a_pos + a_corner*a_size;
  vec2 clip = vec2(p.x/u_res.x*2.0-1.0, 1.0-p.y/u_res.y*2.0);
  gl_Position = vec4(clip,0.0,1.0);
}`;
const NODE_FS = `
precision highp float;
uniform float u_time;
varying vec2 v_corner; varying float v_state;
void main(){
  float d = length(v_corner);
  float glow = smoothstep(1.0,0.0,d);
  float pulse = v_state>1.5 ? (0.55+0.45*sin(u_time*4.5)) : 0.85;
  vec3 col = v_state<0.5 ? vec3(0.35,0.42,0.62)
           : v_state<1.5 ? vec3(0.0,0.88,0.62)
                         : vec3(1.0,0.30,0.44);
  float a = glow*0.6*pulse;
  gl_FragColor = vec4(col*a, a);
}`;

export default function RadialBracket({ rounds }: { rounds: Round[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 720, h: 720 });
  const { w, h } = dims;
  const size = Math.min(w, h); // dimensión de referencia (círculo)
  // Radio del anillo exterior — CIRCULAR (misma medida en ambos ejes), centrado.
  const Rmax = Math.max(60, size / 2 - 46);
  const RmaxX = Rmax;
  const RmaxY = Rmax;
  const [selected, setSelected] = useState<string | null>(null);
  const [fs, setFs] = useState(false); // pantalla completa (solo el radial)
  // Zoom por pasos: 0 = todos los anillos; cada paso lleva el siguiente anillo
  // (R16, cuartos, semis) al borde, ocultando los exteriores. 4 niveles (0..3).
  const [zoomLevel, setZoomLevel] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(false);
  const toggle = (slot: string) =>
    setSelected((s) => (s === slot ? null : slot));
  const ready = (rounds?.length ?? 0) > 0; // el stage recién existe con datos

  // Rueda del mouse: un scroll = un anillo (paso discreto), no continuo.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelLock.current) return; // throttle: un paso por gesto
      wheelLock.current = true;
      window.setTimeout(() => (wheelLock.current = false), 380);
      const dir = e.deltaY < 0 ? 1 : -1;
      setSelected(null);
      setZoomLevel((l) => Math.min(3, Math.max(0, l + dir)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (fs) {
        // Fullscreen: el stage ocupa todo el viewport (no cuadrado) -> el zoom/click
        // no se recorta contra un cuadrado chico.
        setDims({ w: cw, h: ch });
      } else {
        const s = Math.max(320, Math.min(cw, 820));
        setDims({ w: s, h: s }); // cuadrado -> círculo
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fs, ready]);

  // ESC sale de pantalla completa.
  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFs(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);

  // Layout radial: anillo exterior equiespaciado; cada padre = promedio angular de sus hijos.
  const nodes = useMemo<Node[]>(() => {
    if (!rounds?.length) return [];
    const cx = w / 2;
    const cy = h / 2;
    const angle = new Map<string, number>();
    const out: Node[] = [];

    // Anillo exterior (dieciseisavos): en ORDEN DEL ÁRBOL (como llega del servidor,
    // hermanos adyacentes), no por fecha -> así el radial no cruza conectores.
    const outer = rounds[0]?.matches ?? [];
    outer.forEach((m, i) => {
      angle.set(m.slot, ((i + 0.5) / outer.length) * TWO_PI - HALF_PI);
    });
    // Anillos interiores: cada nodo se ubica en el promedio angular de sus
    // alimentadores (los partidos que avanzan hacia él) -> coherente con el árbol.
    for (let r = 1; r < rounds.length; r++) {
      const childRound = rounds[r - 1].matches;
      for (const m of rounds[r].matches) {
        const angs = childRound
          .filter((c) => c.nextSlot === m.slot)
          .map((c) => angle.get(c.slot))
          .filter((a): a is number => a != null);
        angle.set(
          m.slot,
          angs.length
            ? Math.atan2(
                angs.reduce((s, x) => s + Math.sin(x), 0),
                angs.reduce((s, x) => s + Math.cos(x), 0)
              )
            : -HALF_PI
        );
      }
    }

    rounds.forEach((round, r) => {
      const rx = RmaxX * (RING[r] ?? 0);
      const ry = RmaxY * (RING[r] ?? 0);
      for (const m of round.matches) {
        const a = angle.get(m.slot) ?? -HALF_PI;
        const y = cy + Math.sin(a) * ry;
        out.push({
          slot: m.slot,
          nextSlot: m.nextSlot,
          x: cx + Math.cos(a) * rx,
          y,
          round: r,
          live: m.status === "LIVE" || m.status === "PAUSED",
          done: m.status === "FINISHED",
          below: y < cy, // mitad superior -> tooltip debajo
          m,
        });
      }
    });
    return out;
  }, [rounds, w, h, RmaxX, RmaxY]);

  // WebGL: dibuja conectores animados + brillos de nodos.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    if (!gl) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const bySlot = new Map(nodes.map((n) => [n.slot, n]));

    // ---- geometría de conectores (quads con ancho) ----
    const edgeVerts: number[] = [];
    const HW = Math.max(2.4, size * 0.006) * dpr;
    // Distancia del centro al borde del nodo en la dirección (dx,dy) — rectángulo aprox.
    const extent = (node: Node, dx: number, dy: number) => {
      const hw = node.round === 4 ? 72 : 48;
      const hh = node.round === 4 ? 42 : 25;
      return Math.min(
        hw / Math.max(Math.abs(dx), 1e-3),
        hh / Math.max(Math.abs(dy), 1e-3)
      );
    };
    for (const n of nodes) {
      if (!n.nextSlot) continue;
      if (n.round < zoomLevel) continue; // conector de anillo superado -> no se dibuja
      const p = bySlot.get(n.nextSlot);
      if (!p) continue;
      // dirección hijo -> padre
      let ux = p.x - n.x,
        uy = p.y - n.y;
      const d = Math.hypot(ux, uy) || 1;
      ux /= d;
      uy /= d;
      // recorta cada extremo al borde de su caja (borde-a-borde, no centro-a-centro)
      const x0 = (n.x + ux * extent(n, ux, uy)) * dpr;
      const y0 = (n.y + uy * extent(n, ux, uy)) * dpr;
      const x1 = (p.x - ux * extent(p, ux, uy)) * dpr;
      const y1 = (p.y - uy * extent(p, ux, uy)) * dpr;
      let nx = -(y1 - y0),
        ny = x1 - x0;
      const len = Math.hypot(nx, ny) || 1;
      nx = (nx / len) * HW;
      ny = (ny / len) * HW;
      const live = n.live ? 1 : 0;
      // Resuelto (hijo terminado) -> estático; futuro/en vivo -> animado.
      const anim = n.done ? 0 : 1;
      // Partido hijo sin ningún equipo definido -> conector atenuado.
      const dim = !n.m.home.code && !n.m.away.code ? 1 : 0;
      // 2 triángulos: (a,b,c) (c,b,d) ; along 1 en hijo -> 0 en padre
      const A = [x0 + nx, y0 + ny, 1, 1, live, anim, dim];
      const B = [x0 - nx, y0 - ny, 1, -1, live, anim, dim];
      const C = [x1 + nx, y1 + ny, 0, 1, live, anim, dim];
      const D = [x1 - nx, y1 - ny, 0, -1, live, anim, dim];
      edgeVerts.push(...A, ...B, ...C, ...C, ...B, ...D);
    }

    // ---- geometría de nodos (billboards) ----
    const nodeVerts: number[] = [];
    for (const n of nodes) {
      if (n.round < zoomLevel) continue; // brillo de anillo superado -> oculto
      const rad = (n.round === 4 ? 34 : 20 - n.round * 2.2) * dpr;
      const state = n.live ? 2 : n.done ? 1 : 0;
      const x = n.x * dpr,
        y = n.y * dpr;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (const [cxp, cyp] of corners)
        nodeVerts.push(x, y, cxp, cyp, rad, state);
    }

    const edgeProg = makeProgram(gl, EDGE_VS, EDGE_FS);
    const nodeProg = makeProgram(gl, NODE_VS, NODE_FS);
    const edgeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edgeVerts), gl.STATIC_DRAW);
    const nodeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nodeVerts), gl.STATIC_DRAW);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // aditivo -> glow

    const start = performance.now();
    let raf = 0;
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // conectores
      gl.useProgram(edgeProg);
      gl.uniform2f(gl.getUniformLocation(edgeProg, "u_res"), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(edgeProg, "u_time"), t);
      gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuf);
      const stride = 7 * 4;
      bindAttr(gl, edgeProg, "a_pos", 2, stride, 0);
      bindAttr(gl, edgeProg, "a_along", 1, stride, 2 * 4);
      bindAttr(gl, edgeProg, "a_side", 1, stride, 3 * 4);
      bindAttr(gl, edgeProg, "a_live", 1, stride, 4 * 4);
      bindAttr(gl, edgeProg, "a_anim", 1, stride, 5 * 4);
      bindAttr(gl, edgeProg, "a_dim", 1, stride, 6 * 4);
      gl.drawArrays(gl.TRIANGLES, 0, edgeVerts.length / 7);

      // nodos
      gl.useProgram(nodeProg);
      gl.uniform2f(gl.getUniformLocation(nodeProg, "u_res"), canvas.width, canvas.height);
      gl.uniform1f(gl.getUniformLocation(nodeProg, "u_time"), t);
      gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
      const ns = 6 * 4;
      bindAttr(gl, nodeProg, "a_pos", 2, ns, 0);
      bindAttr(gl, nodeProg, "a_corner", 2, ns, 2 * 4);
      bindAttr(gl, nodeProg, "a_size", 1, ns, 4 * 4);
      bindAttr(gl, nodeProg, "a_state", 1, ns, 5 * 4);
      gl.drawArrays(gl.TRIANGLES, 0, nodeVerts.length / 6);

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [nodes, w, h, zoomLevel]);

  // Goleadores del partido seleccionado (on-demand, solo si es de ESPN y ya empezó).
  const selForFetch = nodes.find((n) => n.slot === selected);
  const evId =
    selForFetch &&
    selForFetch.m.matchId.startsWith("ESPN-") &&
    (selForFetch.done || selForFetch.live)
      ? selForFetch.m.matchId.slice(5)
      : null;
  const { data: scorers } = useSWR<{ home: Scorer[]; away: Scorer[] }>(
    evId ? `/api/scorers?event=${evId}` : null,
    scorersFetcher,
    { refreshInterval: selForFetch?.live ? 20000 : 0 }
  );

  if (!rounds?.length)
    return <div className="loading">Aún no hay llaves disponibles.</div>;

  const finalNode = nodes.find((n) => n.round === 4);
  const champ = finalNode?.m;
  const winner =
    champ?.home.winner ? champ.home : champ?.away.winner ? champ.away : null;

  // Próximos partidos (programados o en vivo) ordenados por fecha, para el panel lateral.
  const upcoming = nodes
    .filter((n) => !n.done)
    .sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1; // en vivo primero
      return a.m.utcDate.localeCompare(b.m.utcDate);
    })
    .slice(0, 14);

  // Círculos guía (órbitas) detrás de cada anillo (elipses en pantallas verticales).
  const orbits = RING.slice(0, 4).map((f) => ({ rx: f * RmaxX, ry: f * RmaxY }));

  // Zoom a la zona del nodo seleccionado (suave).
  const sel = nodes.find((n) => n.slot === selected) ?? null;
  const Z = 1.55;
  const sceneStyle: CSSProperties = sel
    ? {
        transform: `translate(${w / 2 - sel.x * Z}px, ${
          h / 2 - sel.y * Z
        }px) scale(${Z})`,
        transformOrigin: "0 0",
      }
    : {
        // Escala para que el anillo del nivel actual quede en el borde.
        transform: `scale(${1 / (RING[zoomLevel] || 1)})`,
        transformOrigin: "50% 50%",
      };

  return (
    <div className={`radial-view ${fs ? "fs" : ""}`}>
      <div className="radial-main" ref={wrapRef}>
        {fs ? (
          <button
            className="radial-fs-close"
            onClick={() => setFs(false)}
            title="Salir de pantalla completa (Esc)"
          >
            ✕
          </button>
        ) : (
          <button
            className="radial-fs-open"
            onClick={() => setFs(true)}
            title="Ver en grande"
          >
            ⛶
          </button>
        )}
        <div
          className="radial-stage"
          ref={stageRef}
          style={{ width: w, height: h }}
          onClick={() => setSelected(null)}
        >
          <div className="radial-scene" style={sceneStyle}>
            {orbits.map((o, i) => (
              <div
                key={i}
                className={`radial-orbit ${i < zoomLevel ? "faded" : ""}`}
                style={{ width: o.rx * 2, height: o.ry * 2, left: w / 2, top: h / 2 }}
              />
            ))}
            <canvas ref={canvasRef} style={{ width: w, height: h }} />
            {nodes
              .filter((n) => n.round !== 4)
              .map((n) => (
                <RadialNode
                  key={n.slot}
                  n={n}
                  active={n.slot === selected}
                  faded={n.round < zoomLevel}
                  onSelect={toggle}
                  scorers={n.slot === selected ? scorers : undefined}
                />
              ))}
            {finalNode && (
              <FinalCenter
                n={finalNode}
                winner={winner}
                active={finalNode.slot === selected}
                onSelect={toggle}
                scorers={finalNode.slot === selected ? scorers : undefined}
              />
            )}
          </div>
        </div>
        {!fs && (
          <div className="radial-legend">
            <span><i className="lg s1" /> 16° · 8°</span>
            <span><i className="lg s2" /> 4° · 2°</span>
            <span><i className="lg s3" /> Final</span>
            <span><i className="lg live" /> En vivo</span>
            <span className="hint">Rueda: acercar ronda por ronda · click en un partido</span>
          </div>
        )}
      </div>

      {/* Panel lateral: próximos partidos por fecha */}
      <aside className="radial-side" hidden={fs}>
        <h3 className="rs-title">Próximos partidos</h3>
        <div className="rs-list">
          {upcoming.map((n) => (
            <button
              key={n.slot}
              className={`rs-item ${n.live ? "live" : ""} ${
                n.slot === selected ? "sel" : ""
              } ${!n.m.home.code && !n.m.away.code ? "empty" : ""}`}
              onClick={() => setSelected(n.slot)}
            >
              <span className="rs-badge">{STAGE_BADGE[n.m.stage] ?? ""}</span>
              <span className="rs-teams">
                <span className="rs-t">
                  <SideTeam t={n.m.home} /> <SideTeam t={n.m.away} />
                </span>
              </span>
              <Broadcaster
                home={n.m.home.code}
                away={n.m.away.code}
                stage={n.m.stage}
                size={12}
              />
              <span className="rs-when">
                {n.live ? (
                  <span className="rs-cd live">🔴 {n.m.minute ?? 0}&apos;</span>
                ) : (
                  <>
                    <span className="rs-date">{kickoff(n.m.utcDate)}</span>
                    <span className="rs-cd">{countdownDetailed(n.m.utcDate)}</span>
                  </>
                )}
              </span>
            </button>
          ))}
          {upcoming.length === 0 && (
            <div className="loading">No hay próximos partidos.</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SideTeam({ t }: { t: BTeam }) {
  return (
    <span className={`rs-team ${t.provisional ? "prov" : ""}`}>
      {t.code ? <Flag value={t.flag} size={13} /> : <span className="fl">⏳</span>}
      <span className="rs-tcode">{t.code ?? "—"}</span>
      {t.score != null && <span className="rs-tsc">{t.score}</span>}
    </span>
  );
}

// Nodo especial de la final, al centro, con trofeo y campeón.
function FinalCenter({
  n,
  winner,
  active,
  onSelect,
  scorers,
}: {
  n: Node;
  winner: BTeam | null;
  active: boolean;
  onSelect: (slot: string) => void;
  scorers?: { home: Scorer[]; away: Scorer[] };
}) {
  const cls = n.live ? "live" : n.done ? "done" : "tbd";
  const row = (t: BTeam) => (
    <div className={`rf-row ${t.winner ? "win" : ""} ${t.lost ? "lose" : ""}`}>
      {t.code ? <Flag value={t.flag} size={18} /> : <span className="fl">⏳</span>}
      <span className="rf-name">{t.code ? t.name : "—"}</span>
      {t.score != null && (
        <span className="rf-sc">
          {t.score}
          {t.pens != null && <span className="rn-pen">({t.pens})</span>}
        </span>
      )}
    </div>
  );
  return (
    <div
      className="radial-center"
      style={{ left: n.x, top: n.y }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(n.slot);
      }}
    >
      <div className="radial-trophy">🏆</div>
      <div
        className={`radial-final stage-FINAL ${cls} ${active ? "active" : ""} ${
          !n.m.home.code && !n.m.away.code ? "empty" : ""
        }`}
      >
        <Broadcaster
          home={n.m.home.code}
          away={n.m.away.code}
          stage={n.m.stage}
          size={13}
        />
        {row(n.m.home)}
        {active && scorers && <GoalsList list={scorers.home} />}
        {row(n.m.away)}
        {active && scorers && <GoalsList list={scorers.away} />}
        <div className="rf-status">{statusLabel(n.m)}</div>
        {active && n.m.venue && <div className="rf-venue">📍 {n.m.venue}</div>}
      </div>
      {winner && <div className="radial-champ">🏅 {winner.name}</div>}
    </div>
  );
}

function bindAttr(
  gl: WebGLRenderingContext,
  prog: WebGLProgram,
  name: string,
  size: number,
  stride: number,
  offset: number
) {
  const loc = gl.getAttribLocation(prog, name);
  if (loc < 0) return;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
}

// Chip por partido. Compacto por defecto; al hacer click se expande con info completa.
function GoalsList({ list }: { list: Scorer[] }) {
  if (!list?.length) return null;
  return (
    <div className="rx-goals">
      {list.map((g, i) => (
        <span key={i} className="rx-goal">
          ⚽ {g.player} {g.minute}
          {g.own ? " (ec)" : ""}
        </span>
      ))}
    </div>
  );
}

function RadialNode({
  n,
  active,
  faded,
  onSelect,
  scorers,
}: {
  n: Node;
  active: boolean;
  faded: boolean;
  onSelect: (slot: string) => void;
  scorers?: { home: Scorer[]; away: Scorer[] };
}) {
  // Tras la animación de crecer, "settled" libera el overflow para mostrar goles.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) return setSettled(false);
    const t = setTimeout(() => setSettled(true), 460);
    return () => clearTimeout(t);
  }, [active]);

  if (n.round === 4) return null; // la final la representa el centro
  const cls = n.live ? "live" : n.done ? "done" : "tbd";
  const empty = !n.m.home.code && !n.m.away.code; // ningún equipo definido

  const chipSide = (t: BTeam) => (
    <div
      className={`rn-team ${t.winner ? "win" : ""} ${t.lost ? "lose" : ""} ${
        t.provisional ? "prov" : ""
      }`}
    >
      {t.code ? <Flag value={t.flag} size={14} /> : <span className="fl">⏳</span>}
      <span className="rn-code">{t.code ?? "—"}</span>
      {t.score != null && (
        <span className="rn-sc">
          {t.score}
          {t.pens != null && <span className="rn-pen">({t.pens})</span>}
        </span>
      )}
    </div>
  );

  const fullSide = (t: BTeam) => (
    <div
      className={`rx-row ${t.winner ? "win" : ""} ${t.lost ? "lose" : ""} ${
        t.provisional ? "prov" : ""
      }`}
    >
      {t.code ? <Flag value={t.flag} size={15} /> : <span className="fl">⏳</span>}
      <span className="rx-name">{t.code ? t.name : t.placeholder}</span>
      <span className="rx-sc">
        {t.score ?? "–"}
        {t.pens != null && <span className="rn-pen"> ({t.pens})</span>}
      </span>
    </div>
  );

  return (
    <div
      className={`radial-node stage-${n.m.stage} ${cls} ${
        active ? "active" : ""
      } ${settled ? "settled" : ""} ${empty ? "empty" : ""} ${
        faded ? "faded" : ""
      }`}
      style={{ left: n.x, top: n.y }}
      onClick={(e) => {
        e.stopPropagation();
        if (faded) return;
        onSelect(n.slot);
      }}
    >
      <Broadcaster
        home={n.m.home.code}
        away={n.m.away.code}
        stage={n.m.stage}
        size={12}
      />

      {active ? (
        <div className="rn-expanded">
          {fullSide(n.m.home)}
          {scorers && <GoalsList list={scorers.home} />}
          {fullSide(n.m.away)}
          {scorers && <GoalsList list={scorers.away} />}
          <div className="rx-meta">{statusLabel(n.m)}</div>
          {n.m.venue && <div className="rx-venue">📍 {n.m.venue}</div>}
        </div>
      ) : (
        <>
          {chipSide(n.m.home)}
          {chipSide(n.m.away)}
          {!n.live && !n.done && countdown(n.m.utcDate) && (
            <span className="rn-when">⏱ {countdown(n.m.utcDate)}</span>
          )}
          {n.live && <span className="rn-min">{n.m.minute ?? 0}&apos;</span>}
        </>
      )}
    </div>
  );
}
