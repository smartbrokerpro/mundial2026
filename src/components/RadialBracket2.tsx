"use client";

// Radial 2 — el bracket de eliminación directa como ESCENA 3D REAL (sin librerías).
// La llave es una montaña: dieciseisavos en la base, cada ronda sube un nivel y la
// final corona la cumbre con un pilar de luz. Proyección en perspectiva hecha a mano,
// cámara orbital (arrastrar rota, rueda/pellizco acercan, doble toque reinicia),
// auto-órbita en reposo. Todo el arte es GPU: campo de estrellas con paralaje,
// anillos orbitales con cometas, conectores bezier 3D con ríos de partículas
// (dorado = ganador ya avanzó, rojo = en vivo, azul = futuro), tornados de chispas
// sobre partidos en vivo y bursts de partículas al seleccionar — cero blur.
// Las cajas de partidos son DOM (texto nítido) proyectadas con la MISMA cámara,
// con profundidad real: se ocultan, ordenan y atenúan según distancia.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
interface Round {
  stage: string;
  title: string;
  matches: BMatch[];
}
interface Node {
  slot: string;
  nextSlot: string | null;
  az: number; // ángulo en el plano horizontal
  wx: number; // posición 3D en mundo
  wy: number;
  wz: number;
  round: number; // 0 = base (R32) ... 4 = cumbre (final)
  live: boolean;
  done: boolean;
  empty: boolean;
  m: BMatch;
}

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

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
// Radio y altura de cada ronda: anillos que se cierran y suben hacia la cumbre.
const RADIUS = [1.0, 0.78, 0.56, 0.36, 0.0];
const HEIGHT = [0.0, 0.2, 0.38, 0.55, 0.74];
const APEX: [number, number, number] = [0, HEIGHT[4], 0];
const TARGET0: [number, number, number] = [0, 0.3, 0];
const FOV_TAN = Math.tan((50 * Math.PI) / 180 / 2);
const PITCH0 = 0.42;
const PITCH_MIN = 0.12;
const PITCH_MAX = 1.25;
const DIST_MIN = 1.3;

// RNG determinista: los buffers se reconstruyen en cada refresh de datos (15s)
// y las partículas no deben "saltar" a posiciones nuevas.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Shaders ----------
// Proyección en perspectiva compartida por todos los programas: base de cámara
// (right/up/forward + foco en px). La misma matemática corre en JS para el DOM.
const P3 = `
uniform vec3 u_eye; uniform vec3 u_right; uniform vec3 u_upv; uniform vec3 u_fwd;
uniform float u_fpx; uniform vec2 u_res;
float projVZ(vec3 p, out vec2 ndc){
  vec3 rel = p - u_eye;
  float vz = dot(rel, u_fwd);
  vec2 v = vec2(dot(rel, u_right), dot(rel, u_upv));
  ndc = (v * u_fpx / max(vz, 0.05)) / (u_res * 0.5);
  return vz;
}
vec4 clipOf(vec2 ndc, float vz){
  if (vz < 0.06) return vec4(0.0, 0.0, 2.0, 1.0);
  return vec4(ndc, 0.0, 1.0);
}
float fogOf(float vz){ return exp(-max(vz - 1.7, 0.0) * 0.5); }
`;

// Zoom por capas: u_fade.xyzw = disolución (0..1) de cada anillo (R32..SF).
// Un anillo superado no se difumina: se DESINTEGRA en partículas y desaparece.
const FADE = `
uniform vec4 u_fade;
float fadeOf(float lv){
  return lv < 0.5 ? u_fade.x : lv < 1.5 ? u_fade.y : lv < 2.5 ? u_fade.z : lv < 3.5 ? u_fade.w : 0.0;
}`;

// Campo de estrellas 3D: el paralaje al orbitar vende la profundidad de la escena.
const STAR_VS = `${P3}
attribute vec3 a_pos; attribute vec3 a_par;
uniform float u_time; uniform float u_dpr; uniform float u_motion;
varying float v_a; varying float v_hue;
void main(){
  vec2 ndc; float vz = projVZ(a_pos, ndc);
  gl_Position = clipOf(ndc, vz);
  float tw = 0.5 + 0.5 * sin(u_time * (0.4 + a_par.x * 2.2) * u_motion + a_par.x * 43.0);
  v_a = mix(0.25, 1.0, tw) * fogOf(vz);
  v_hue = a_par.z;
  gl_PointSize = clamp((0.006 + 0.012 * a_par.y) * u_fpx / max(vz, 0.06) * u_dpr, 1.0, 7.0);
}`;
const STAR_FS = `
precision mediump float;
varying float v_a; varying float v_hue;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.0, d);
  vec3 col = mix(vec3(0.55, 0.68, 1.0), vec3(1.0, 0.85, 0.6), v_hue);
  float a = disc * disc * v_a * 0.5;
  gl_FragColor = vec4(col * a, a);
}`;

// Suelo: disco de energía bajo la montaña con ondas concéntricas que emanan.
const GROUND_VS = `${P3}
attribute vec3 a_pos;
varying vec2 v_w;
void main(){
  v_w = a_pos.xz;
  vec2 ndc; float vz = projVZ(a_pos, ndc);
  gl_Position = clipOf(ndc, vz);
}`;
const GROUND_FS = `
precision mediump float;
uniform float u_time; uniform float u_motion;
varying vec2 v_w;
void main(){
  float r = length(v_w);
  float glow = exp(-r * r * 2.8) * 0.20;
  float wave = pow(0.5 + 0.5 * sin(r * 18.0 - u_time * 1.1 * u_motion), 4.0);
  glow += wave * exp(-r * 3.8) * 0.05;
  vec3 col = mix(vec3(0.05, 0.10, 0.30), vec3(0.10, 0.25, 0.60), wave) * glow * 2.6;
  gl_FragColor = vec4(col, glow);
}`;

// Anillos orbitales por ronda, con un cometa recorriendo cada órbita.
const RING_VS = `${P3}${FADE}
attribute vec3 a_pos; attribute float a_side; attribute float a_ang; attribute float a_lv;
varying float v_side; varying float v_ang; varying float v_lv; varying float v_fog;
void main(){
  v_side = a_side; v_ang = a_ang; v_lv = a_lv;
  vec2 ndc; float vz = projVZ(a_pos, ndc);
  v_fog = fogOf(vz) * (1.0 - fadeOf(a_lv));
  gl_Position = clipOf(ndc, vz);
}`;
const RING_FS = `
precision mediump float;
uniform float u_time; uniform float u_motion;
varying float v_side; varying float v_ang; varying float v_lv; varying float v_fog;
void main(){
  float core = 1.0 - abs(v_side);
  core = core * core;
  float comet = pow(0.5 + 0.5 * sin(v_ang - u_time * (0.35 + v_lv * 0.18) * u_motion), 24.0);
  vec3 col = vec3(0.25, 0.42, 0.95) * (0.10 + 0.05 * v_lv) + vec3(0.5, 0.75, 1.0) * comet * 0.9;
  float a = core * (0.10 + 0.06 * v_lv + comet * 0.8) * v_fog;
  gl_FragColor = vec4(col * a, a);
}`;

// Conectores: arcos bezier 3D hijo->padre extruidos en pantalla, con pulso de
// energía subiendo la montaña. Dorado = resuelto, rojo = en vivo, azul = futuro.
const EDGE_VS = `${P3}${FADE}
attribute vec3 a_pA; attribute vec3 a_pB; attribute float a_end;
attribute float a_along; attribute float a_side; attribute vec3 a_st; attribute float a_lv;
varying float v_along; varying float v_side; varying vec3 v_st; varying float v_fog;
void main(){
  v_along = a_along; v_side = a_side; v_st = a_st;
  vec2 nA; float vzA = projVZ(a_pA, nA);
  vec2 nB; float vzB = projVZ(a_pB, nB);
  float vz = mix(vzA, vzB, a_end);
  v_fog = fogOf(vz) * (1.0 - fadeOf(a_lv));
  vec2 PA = nA * u_res * 0.5; vec2 PB = nB * u_res * 0.5;
  vec2 dir = PB - PA;
  float len = max(length(dir), 0.0001);
  vec2 n = vec2(-dir.y, dir.x) / len;
  float hw = clamp(0.006 * u_fpx / max(vz, 0.06), 0.7, 3.2);
  vec2 P = mix(PA, PB, a_end) + n * a_side * hw;
  gl_Position = clipOf(P / (u_res * 0.5), min(vzA, vzB));
}`;
const EDGE_FS = `
precision mediump float;
uniform float u_time; uniform float u_motion;
varying float v_along; varying float v_side; varying vec3 v_st; varying float v_fog;
void main(){
  float core = 1.0 - abs(v_side);
  core = core * core * (3.0 - 2.0 * core);
  float dim = mix(1.0, 0.3, v_st.z);
  vec3 col; float a;
  if (v_st.y > 0.5) {
    float flow = pow(0.5 + 0.5 * sin(v_along * 16.0 - u_time * 1.6 * u_motion), 2.0);
    col = vec3(1.0, 0.72, 0.25) * (0.5 + 0.6 * flow);
    a = core * (0.30 + 0.30 * flow);
  } else {
    float speed = mix(2.4, 6.0, v_st.x) * u_motion;
    float flow = pow(0.5 + 0.5 * sin(v_along * 22.0 - u_time * speed), 2.0);
    vec3 base = mix(vec3(0.15, 0.42, 1.0), vec3(1.0, 0.22, 0.38), v_st.x);
    col = base * (0.35 + 0.9 * flow);
    a = core * (0.12 + 0.5 * flow) * dim;
  }
  gl_FragColor = vec4(col * a * v_fog, a * v_fog);
}`;

// Ríos de partículas: evalúan el bezier 3D en la GPU y suben hacia la cumbre.
const FLOW_VS = `${P3}${FADE}
attribute vec3 a_p0; attribute vec3 a_c; attribute vec3 a_p1;
attribute vec4 a_par; attribute vec3 a_st; attribute float a_lv;
uniform float u_time; uniform float u_dpr; uniform float u_motion;
varying float v_env; varying vec3 v_st; varying float v_fog;
void main(){
  v_st = a_st;
  float speed = mix(mix(0.10, 0.055, a_st.y), 0.30, a_st.x) * a_par.y * u_motion + 0.008;
  float t = fract(a_par.x + u_time * speed);
  v_env = sin(t * 3.14159);
  vec3 p = mix(mix(a_p0, a_c, t), mix(a_c, a_p1, t), t);
  p.y += sin(t * 21.0 + a_par.x * 57.0) * 0.006 * a_par.w;
  vec2 ndc; float vz = projVZ(p, ndc);
  v_fog = fogOf(vz) * (1.0 - fadeOf(a_lv));
  gl_Position = clipOf(ndc, vz);
  float sz = (0.010 + 0.022 * v_env) * a_par.z * u_fpx / max(vz, 0.06) * u_dpr;
  gl_PointSize = clamp(sz, 1.0, 22.0);
}`;
const FLOW_FS = `
precision mediump float;
varying float v_env; varying vec3 v_st; varying float v_fog;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.0, d);
  disc *= disc;
  vec3 col = mix(mix(vec3(0.35, 0.62, 1.0), vec3(1.0, 0.78, 0.30), v_st.y), vec3(1.0, 0.32, 0.42), v_st.x);
  float a = disc * v_env * 0.9 * mix(1.0, 0.25, v_st.z) * v_fog;
  gl_FragColor = vec4(col * a, a);
}`;

// Tornado de chispas sobre cada partido EN VIVO.
const SPARK_VS = `${P3}${FADE}
attribute vec3 a_c; attribute vec4 a_par; attribute float a_lv;
uniform float u_time; uniform float u_dpr; uniform float u_motion;
varying float v_a; varying float v_fog;
void main(){
  float ang = a_par.y + u_time * a_par.z * max(u_motion, 0.3);
  vec3 p = a_c + vec3(cos(ang) * a_par.x, 0.02 + 0.035 * sin(u_time * 1.9 + a_par.y * 7.0), sin(ang) * a_par.x);
  vec2 ndc; float vz = projVZ(p, ndc);
  v_fog = fogOf(vz) * (1.0 - fadeOf(a_lv));
  gl_Position = clipOf(ndc, vz);
  v_a = 0.5 + 0.5 * sin(u_time * 3.0 + a_par.y * 11.0);
  gl_PointSize = clamp((0.008 + 0.010 * a_par.w) * u_fpx / max(vz, 0.06) * u_dpr, 1.0, 12.0);
}`;
const SPARK_FS = `
precision mediump float;
varying float v_a; varying float v_fog;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.0, d);
  vec3 col = mix(vec3(1.0, 0.30, 0.35), vec3(1.0, 0.62, 0.30), v_a);
  float a = disc * disc * (0.35 + 0.55 * v_a) * v_fog;
  gl_FragColor = vec4(col * a, a);
}`;

// Desintegración por capas: LA CAJA MISMA se disuelve en partículas. Cada caja
// tiene una gemela hecha de "chunks" (grilla de pixeles con sus colores reales:
// fondo, filas de texto, borde según estado) posicionada en su mismo plano
// billboard. Al superar el anillo, el DOM se intercambia por la gemela en ~40ms
// y los chunks salen volando con retardo escalonado; al bajar, se reensamblan.
const DISS_VS = `${P3}${FADE}
attribute vec3 a_pos; attribute vec2 a_uv; attribute vec3 a_dir;
attribute vec3 a_col; attribute vec2 a_par; attribute float a_lv;
uniform float u_time; uniform float u_dpr; uniform float u_cardk; uniform float u_chunk;
uniform vec4 u_dir; // 1 = anillo desintegrándose; 0 = vivo/reapareciendo
varying vec3 v_col; varying float v_a;
void main(){
  float fade = fadeOf(a_lv);
  float dir = a_lv < 0.5 ? u_dir.x : a_lv < 1.5 ? u_dir.y : a_lv < 2.5 ? u_dir.z : a_lv < 3.5 ? u_dir.w : 0.0;
  // El reensamble inverso nunca calza perfecto con el DOM: los chunks sólo
  // existen al DESAPARECER; la vuelta es un fade-in simple de la caja real.
  if (fade < 0.02 || dir < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; v_a = 0.0; v_col = a_col; return; }
  float on = smoothstep(0.02, 0.13, fade);
  float fly = clamp((fade - 0.12 - a_par.y * 0.35) / 0.45, 0.0, 1.0);
  fly = fly * fly * (3.0 - 2.0 * fly);
  // Chunk en el plano de la caja (billboard: mismos ejes right/up de la cámara).
  vec3 p = a_pos + (u_right * a_uv.x + u_upv * a_uv.y) * u_cardk;
  p += a_dir * fly * (0.20 + 0.30 * a_par.x);
  p.y += fly * fly * 0.06;
  p.x += sin(u_time * 2.3 + a_par.x * 37.0) * fly * 0.012;
  p.z += cos(u_time * 1.9 + a_par.y * 29.0) * fly * 0.012;
  vec2 ndc; float vz = projVZ(p, ndc);
  gl_Position = clipOf(ndc, vz);
  v_col = a_col + vec3(0.10, 0.30, 0.25) * fly; // se energiza al volar
  v_a = on * (1.0 - fly);
  gl_PointSize = clamp(u_chunk * (1.0 - fly * 0.45) * u_fpx / max(vz, 0.06) * u_dpr, 1.0, 22.0);
}`;
const DISS_FS = `
precision mediump float;
varying vec3 v_col; varying float v_a;
void main(){
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
  float m = 1.0 - smoothstep(0.72, 1.0, max(q.x, q.y)); // pixel cuadrado, borde suave
  float a = m * v_a;
  gl_FragColor = vec4(v_col * a, a);
}`;

// Burst: explosión esférica de partículas al seleccionar (reemplaza cualquier blur).
const BURST_VS = `${P3}
attribute vec3 a_dir; attribute vec2 a_par;
uniform float u_time; uniform float u_dpr;
uniform vec3 u_bpos; uniform float u_bage; uniform float u_bgold;
varying float v_a; varying float v_gold;
void main(){
  float age = clamp(u_bage * (0.75 + 0.5 * a_par.x), 0.0, 1.0);
  if (u_bage < 0.0 || age >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; v_a = 0.0; v_gold = u_bgold; return; }
  float ease = 1.0 - pow(1.0 - age, 2.5);
  vec3 p = u_bpos + a_dir * (0.03 + ease * 0.28);
  p.y += age * age * 0.05;
  vec2 ndc; float vz = projVZ(p, ndc);
  gl_Position = clipOf(ndc, vz);
  v_a = (1.0 - age) * (1.0 - age);
  v_gold = u_bgold;
  gl_PointSize = clamp((0.008 + 0.014 * a_par.y) * (1.0 - age * 0.6) * u_fpx / max(vz, 0.06) * u_dpr, 1.0, 16.0);
}`;
const BURST_FS = `
precision mediump float;
varying float v_a; varying float v_gold;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.0, d);
  vec3 col = mix(vec3(0.55, 0.85, 1.0), vec3(1.0, 0.8, 0.3), v_gold);
  float a = disc * disc * v_a;
  gl_FragColor = vec4(col * a, a);
}`;

// Pilar de luz en la cumbre: azul mientras se define, dorado cuando hay campeón.
const BEAM_VS = `${P3}
attribute vec2 a_q;
uniform vec3 u_apex;
varying vec2 v_q;
void main(){
  v_q = a_q;
  vec3 base = u_apex + vec3(0.0, 0.06 + a_q.x * 0.62, 0.0);
  vec2 ndc; float vz = projVZ(base, ndc);
  vec2 P = ndc * u_res * 0.5;
  float wpx = (1.0 - a_q.x * 0.55) * 0.045 * u_fpx / max(vz, 0.06);
  P.x += a_q.y * wpx;
  gl_Position = clipOf(P / (u_res * 0.5), vz);
}`;
const BEAM_FS = `
precision mediump float;
uniform float u_time; uniform float u_motion; uniform float u_gold;
varying vec2 v_q;
void main(){
  float across = exp(-v_q.y * v_q.y * 3.5);
  float vert = (1.0 - v_q.x) * smoothstep(0.0, 0.10, v_q.x);
  float flicker = 0.85 + 0.15 * sin(u_time * 2.4 * u_motion + v_q.x * 9.0);
  vec3 col = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.78, 0.30), u_gold);
  float a = across * vert * flicker * (0.20 + 0.25 * u_gold);
  gl_FragColor = vec4(col * a, a);
}`;

// ---------- WebGL helpers ----------
function makeProgram(
  gl: WebGLRenderingContext,
  vs: string,
  fs: string
): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("[radial2] shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn("[radial2] link:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

interface Batch {
  prog: WebGLProgram;
  buf: WebGLBuffer;
  mode: number;
  count: number;
  stride: number;
  attribs: { loc: number; size: number; offset: number }[];
  uni: Record<string, WebGLUniformLocation | null>;
}

function makeBatch(
  gl: WebGLRenderingContext,
  vs: string,
  fs: string,
  attribDefs: [string, number][],
  data: Float32Array,
  mode: number,
  extraUniforms: string[] = []
): Batch | null {
  const prog = makeProgram(gl, vs, fs);
  if (!prog) return null;
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const floats = attribDefs.reduce((s, [, n]) => s + n, 0);
  let off = 0;
  const attribs = attribDefs.map(([name, size]) => {
    const a = { loc: gl.getAttribLocation(prog, name), size, offset: off * 4 };
    off += size;
    return a;
  });
  const uni: Record<string, WebGLUniformLocation | null> = {};
  for (const u of [
    "u_eye", "u_right", "u_upv", "u_fwd", "u_fpx",
    "u_res", "u_dpr", "u_time", "u_motion",
    ...extraUniforms,
  ])
    uni[u] = gl.getUniformLocation(prog, u);
  return {
    prog,
    buf,
    mode,
    count: data.length / floats,
    stride: floats * 4,
    attribs,
    uni,
  };
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export default function RadialBracket2({ rounds }: { rounds: Round[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 720, h: 720 });
  const { w, h } = dims;
  const [selected, setSelected] = useState<string | null>(null);
  const [fs, setFs] = useState(false);
  // Calidad auto-adaptativa: 2 = full, 1 = medio, 0 = ahorro (dpr y partículas bajan).
  const [quality, setQuality] = useState<0 | 1 | 2>(2);
  const [glEpoch, setGlEpoch] = useState(0);
  // Zoom POR CAPAS: 0 = montaña completa; cada paso desintegra el anillo exterior
  // y la cámara vuela a encuadrar el siguiente (1 = octavos, 2 = cuartos, 3 = semis).
  const [zoomLevel, setZoomLevel] = useState(0);
  const zoomRef = useRef(0);
  const fadeRef = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  const wheelLock = useRef(false);

  const fpx = h / 2 / FOV_TAN; // foco de la cámara en px
  // Distancia que encuadra la montaña completa en este viewport.
  const distFit = Math.max(2.4, (2 * fpx * 1.32) / w);
  const distMax = distFit * 2.1;

  // Cámara orbital persistente. Intro: parte alta y lejana, vuela a la vista normal.
  const camRef = useRef({
    yaw: 0.6, pitch: 1.1, dist: 5.5,
    tx: TARGET0[0], ty: TARGET0[1], tz: TARGET0[2],
    yawT: 0.6, pitchT: PITCH0, distT: 2.8,
    txT: TARGET0[0], tyT: TARGET0[1], tzT: TARGET0[2],
    init: false,
  });
  const selectedRef = useRef<string | null>(null);
  const lastInteractRef = useRef(0);
  const burstRef = useRef({ x: 0, y: 0, z: 0, t0: -1, gold: 0 });
  const visibleRef = useRef(true);
  const t0Ref = useRef(-1);
  // Elementos DOM proyectados por frame (cajas, final, trofeo): sin re-render de React.
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const ready = (rounds?.length ?? 0) > 0;

  const clampCam = () => {
    const c = camRef.current;
    c.pitchT = Math.min(PITCH_MAX, Math.max(PITCH_MIN, c.pitchT));
    c.distT = Math.min(distMax, Math.max(DIST_MIN, c.distT));
  };

  // ---- medición del contenedor (cuadrado; fullscreen = viewport completo) ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (fs) setDims({ w: cw, h: ch });
      else {
        const s = Math.max(320, Math.min(cw, 820));
        setDims({ w: s, h: s });
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

  // Encuadra el anillo del nivel dado: distancia según su radio, mirada al tramo
  // de montaña que queda vivo (anillo actual -> cumbre).
  const frameLevel = (l: number) => {
    const c = camRef.current;
    const R = RADIUS[Math.min(l, 3)];
    c.distT = Math.max(1.45, (2 * fpx * (R + 0.32)) / w);
    c.pitchT = PITCH0 + l * 0.06;
    c.txT = 0;
    c.tzT = 0;
    c.tyT = (HEIGHT[Math.min(l, 3)] + HEIGHT[4]) / 2 - 0.02;
  };

  // Encuadre inicial, por cambio de nivel y al cambiar tamaño.
  useEffect(() => {
    zoomRef.current = zoomLevel;
    if (!selectedRef.current) frameLevel(zoomLevel);
    const c = camRef.current;
    if (!c.init) {
      c.init = true;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        ?.matches;
      if (reduced) {
        c.yaw = c.yawT;
        c.pitch = c.pitchT;
        c.dist = c.distT;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel, distFit]);

  // ESC: sale de fullscreen o deselecciona.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fs) setFs(false);
      else setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);

  // Pausa el render cuando el radial sale del viewport (scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => (visibleRef.current = entries[0]?.isIntersecting ?? true)
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  // ---- layout 3D: mismo árbol angular del radial clásico, elevado a cono ----
  const nodes = useMemo<Node[]>(() => {
    if (!rounds?.length) return [];
    const angle = new Map<string, number>();
    const out: Node[] = [];
    const outer = rounds[0]?.matches ?? [];
    outer.forEach((m, i) => {
      angle.set(m.slot, ((i + 0.5) / outer.length) * TWO_PI - HALF_PI);
    });
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
      const R = RADIUS[r] ?? 0;
      for (const m of round.matches) {
        const a = angle.get(m.slot) ?? -HALF_PI;
        out.push({
          slot: m.slot,
          nextSlot: m.nextSlot,
          az: a,
          wx: Math.cos(a) * R,
          wy: HEIGHT[r] ?? 0,
          wz: Math.sin(a) * R,
          round: r,
          live: m.status === "LIVE" || m.status === "PAUSED",
          done: m.status === "FINISHED",
          empty: !m.home.code && !m.away.code,
          m,
        });
      }
    });
    return out;
  }, [rounds]);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Al seleccionar: la cámara orbita hasta poner el partido de frente y se acerca,
  // y estalla un burst de partículas en su posición. Al deseleccionar, reencuadra
  // el anillo del nivel actual.
  useEffect(() => {
    if (!selected) {
      if (camRef.current.init) frameLevel(zoomRef.current);
      return;
    }
    const n = nodes.find((nn) => nn.slot === selected);
    if (!n) return;
    // Partido de una ronda ya desintegrada (elegido en el panel lateral):
    // baja el nivel para que su anillo se reintegre.
    if (n.round < 4 && n.round < zoomRef.current) setZoomLevel(n.round);
    const c = camRef.current;
    if (n.round !== 4) {
      const targetYaw = HALF_PI - n.az;
      const d = Math.atan2(Math.sin(targetYaw - c.yawT), Math.cos(targetYaw - c.yawT));
      c.yawT += d;
    }
    c.pitchT = 0.5;
    c.distT = Math.min(Math.max(c.distT * 0.72, 1.55), 2.0);
    c.txT = n.wx * 0.55;
    c.tyT = TARGET0[1] * 0.45 + n.wy * 0.55;
    c.tzT = n.wz * 0.55;
    clampCam();
    burstRef.current = { x: n.wx, y: n.wy, z: n.wz, t0: performance.now(), gold: n.done ? 1 : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, nodes]);

  const resetCamera = () => {
    setSelected(null);
    setZoomLevel(0);
    frameLevel(0);
    lastInteractRef.current = performance.now();
  };

  // Un paso de zoom = un anillo: desintegra el exterior (o lo reintegra al bajar).
  const stepZoom = (dir: number) => {
    lastInteractRef.current = performance.now();
    setSelected(null);
    setZoomLevel((l) => Math.min(3, Math.max(0, l + dir)));
  };

  // ---- WebGL: construye la escena 3D y corre el loop de render ----
  const winnerExists = nodes.some((n) => n.round === 4 && n.done);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const onLost = (e: Event) => {
      e.preventDefault();
      setGlEpoch((n) => n + 1);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    const dprCap = quality === 2 ? 2 : quality === 1 ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const density = quality === 2 ? 1 : quality === 1 ? 0.6 : 0.35;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches
      ? 0.15
      : 1;
    const rnd = mulberry32(20260702);
    const bySlot = new Map(nodes.map((n) => [n.slot, n]));

    // Estrellas.
    const stars: number[] = [];
    const nStars = Math.round(520 * density);
    for (let i = 0; i < nStars; i++) {
      const r = 0.35 + Math.pow(rnd(), 0.6) * 3.1;
      const a = rnd() * TWO_PI;
      stars.push(
        Math.cos(a) * r, -0.25 + rnd() * 1.9, Math.sin(a) * r,
        rnd(), rnd(), rnd() < 0.2 ? rnd() : 0
      );
    }

    // Suelo (quad grande en y=0).
    const G = 1.55;
    const ground = [
      -G, 0, -G, G, 0, -G, G, 0, G,
      -G, 0, -G, G, 0, G, -G, 0, G,
    ];

    // Anillos orbitales (bandas 3D con 96 segmentos).
    const rings: number[] = [];
    const SEG = 96;
    const RW = 0.010;
    for (let lv = 0; lv < 4; lv++) {
      const R = RADIUS[lv];
      const y = HEIGHT[lv];
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * TWO_PI;
        const a1 = ((i + 1) / SEG) * TWO_PI;
        const v = (a: number, side: number) => {
          const rr = R + side * RW;
          rings.push(Math.cos(a) * rr, y, Math.sin(a) * rr, side, a, lv);
        };
        v(a0, -1); v(a0, 1); v(a1, 1);
        v(a0, -1); v(a1, 1); v(a1, -1);
      }
    }

    // Conectores bezier 3D + datos para los ríos de partículas.
    const edge: number[] = [];
    const flows: {
      p0: V3; c: V3; p1: V3; live: number; done: number; dim: number; lv: number;
    }[] = [];
    const SSEG = 18;
    for (const n of nodes) {
      if (!n.nextSlot) continue;
      const p = bySlot.get(n.nextSlot);
      if (!p) continue;
      const P0: V3 = [n.wx, n.wy, n.wz];
      const P1: V3 = [p.wx, p.wy, p.wz];
      const mid: V3 = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2, (P0[2] + P1[2]) / 2];
      const rl = Math.hypot(mid[0], mid[2]) || 1;
      // Control: el arco se comba hacia afuera y arriba -> las líneas "escalan" la montaña.
      const C: V3 = [
        mid[0] + (mid[0] / rl) * 0.09,
        mid[1] + 0.07,
        mid[2] + (mid[2] / rl) * 0.09,
      ];
      const live = n.live ? 1 : 0;
      const done = n.done ? 1 : 0;
      const dim = n.empty ? 1 : 0;
      const bez = (t: number): V3 => {
        const u = 1 - t;
        return [
          u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0],
          u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1],
          u * u * P0[2] + 2 * u * t * C[2] + t * t * P1[2],
        ];
      };
      for (let i = 0; i < SSEG; i++) {
        const t0 = 0.05 + (i / SSEG) * 0.9;
        const t1 = 0.05 + ((i + 1) / SSEG) * 0.9;
        const A = bez(t0);
        const B = bez(t1);
        const v = (end: number, side: number) =>
          edge.push(...A, ...B, end, end ? t1 : t0, side, live, done, dim, n.round);
        v(0, 1); v(0, -1); v(1, 1);
        v(0, -1); v(1, -1); v(1, 1);
      }
      flows.push({ p0: P0, c: C, p1: P1, live, done, dim, lv: n.round });
    }

    // Partículas de flujo por conector.
    const flow: number[] = [];
    for (const f of flows) {
      const count = Math.max(
        2,
        Math.round((f.done ? 5 : f.live ? 14 : 6) * density)
      );
      for (let i = 0; i < count; i++)
        flow.push(
          ...f.p0, ...f.c, ...f.p1,
          rnd(), 0.7 + rnd() * 0.6, 0.7 + rnd() * 0.7, rnd(),
          f.live, f.done, f.dim, f.lv
        );
    }

    // Tornados de chispas en partidos en vivo.
    const sparks: number[] = [];
    for (const n of nodes) {
      if (!n.live) continue;
      const count = Math.round(22 * Math.max(density, 0.5));
      for (let i = 0; i < count; i++)
        sparks.push(
          n.wx, n.wy, n.wz,
          0.05 + rnd() * 0.06, rnd() * TWO_PI,
          (rnd() < 0.5 ? -1 : 1) * (1.1 + rnd() * 1.4), rnd(),
          n.round
        );
    }

    // Gemela de partículas de cada caja: grilla de chunks con los colores reales
    // (fondo, filas de texto, borde por estado). Vive en el plano billboard de la
    // caja y sólo se ve durante la transición de su anillo.
    const cardK = Math.max(0.0019, 1.05 / fpx); // px de caja -> unidades de mundo
    const small = Math.min(w, h) < 560;
    const CW = small ? 42 : 64; // tamaño aprox de la caja compacta en px
    const CH = small ? 30 : 44;
    const [GW, GH] = quality === 2 ? [16, 10] : quality === 1 ? [12, 8] : [9, 6];
    const chunkWorld = (CW / GW) * 1.35 * cardK;
    const diss: number[] = [];
    for (const n of nodes) {
      if (n.round >= 4) continue;
      const bg: V3 = n.done ? [0.82, 0.91, 0.87] : [0.05, 0.08, 0.16];
      const text: V3 = n.done ? [0.07, 0.14, 0.22] : [0.62, 0.70, 0.88];
      const border: V3 = n.live
        ? [0.95, 0.26, 0.40]
        : n.done
        ? [0.06, 0.60, 0.44]
        : [0.02, 0.50, 0.40];
      for (let gy = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++) {
          const u = ((gx + 0.5) / GW - 0.5) * CW;
          const v = (0.5 - (gy + 0.5) / GH) * CH;
          const isEdge = gx === 0 || gx === GW - 1 || gy === 0 || gy === GH - 1;
          const fy = (gy + 0.5) / GH;
          const inRow =
            Math.abs(fy - 0.32) < 0.13 || Math.abs(fy - 0.68) < 0.13;
          const jit = 0.88 + rnd() * 0.24;
          const c: V3 = isEdge
            ? border
            : inRow && rnd() < 0.55
            ? text
            : bg;
          const dir = norm([
            Math.cos(n.az) + (rnd() - 0.5) * 1.1,
            0.15 + rnd() * 0.85,
            Math.sin(n.az) + (rnd() - 0.5) * 1.1,
          ]);
          diss.push(
            n.wx, n.wy, n.wz,
            u, v,
            ...dir,
            c[0] * jit, c[1] * jit, c[2] * jit,
            rnd(), rnd(),
            n.round
          );
        }
      }
    }

    // Burst de selección (geometría fija, se dispara por uniforms).
    const burst: number[] = [];
    for (let i = 0; i < 90; i++) {
      const th = rnd() * TWO_PI;
      const ph = Math.acos(2 * rnd() - 1);
      burst.push(
        Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th),
        rnd(), rnd()
      );
    }

    // Pilar de luz (un quad; el degradé lo hace el fragment shader).
    const beam = [
      0, -1, 0, 1, 1, 1,
      0, -1, 1, 1, 1, -1,
    ];

    const bStars = makeBatch(gl, STAR_VS, STAR_FS,
      [["a_pos", 3], ["a_par", 3]], new Float32Array(stars), gl.POINTS);
    const bGround = makeBatch(gl, GROUND_VS, GROUND_FS,
      [["a_pos", 3]], new Float32Array(ground), gl.TRIANGLES);
    const bRings = makeBatch(gl, RING_VS, RING_FS,
      [["a_pos", 3], ["a_side", 1], ["a_ang", 1], ["a_lv", 1]],
      new Float32Array(rings), gl.TRIANGLES, ["u_fade"]);
    const bEdges = makeBatch(gl, EDGE_VS, EDGE_FS,
      [["a_pA", 3], ["a_pB", 3], ["a_end", 1], ["a_along", 1], ["a_side", 1], ["a_st", 3], ["a_lv", 1]],
      new Float32Array(edge), gl.TRIANGLES, ["u_fade"]);
    const bFlow = makeBatch(gl, FLOW_VS, FLOW_FS,
      [["a_p0", 3], ["a_c", 3], ["a_p1", 3], ["a_par", 4], ["a_st", 3], ["a_lv", 1]],
      new Float32Array(flow), gl.POINTS, ["u_fade"]);
    const bSparks = makeBatch(gl, SPARK_VS, SPARK_FS,
      [["a_c", 3], ["a_par", 4], ["a_lv", 1]], new Float32Array(sparks), gl.POINTS,
      ["u_fade"]);
    const bDiss = makeBatch(gl, DISS_VS, DISS_FS,
      [["a_pos", 3], ["a_uv", 2], ["a_dir", 3], ["a_col", 3], ["a_par", 2], ["a_lv", 1]],
      new Float32Array(diss), gl.POINTS,
      ["u_fade", "u_cardk", "u_chunk", "u_dir"]);
    const bBurst = makeBatch(gl, BURST_VS, BURST_FS,
      [["a_dir", 3], ["a_par", 2]], new Float32Array(burst), gl.POINTS,
      ["u_bpos", "u_bage", "u_bgold"]);
    const bBeam = makeBatch(gl, BEAM_VS, BEAM_FS,
      [["a_q", 2]], new Float32Array(beam), gl.TRIANGLES,
      ["u_apex", "u_gold"]);
    const batches = [bStars, bGround, bRings, bEdges, bFlow, bSparks, bDiss, bBurst, bBeam];

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // aditivo -> todo brilla

    if (t0Ref.current < 0) t0Ref.current = performance.now();
    const cam = camRef.current;
    let raf = 0;
    let last = performance.now();
    let slowFrames = 0;
    let warmup = 60;
    let downgraded = false;
    let t = 0;
    let eye: V3 = [0, 0, 0];
    let rightV: V3 = [1, 0, 0];
    let upV: V3 = [0, 1, 0];
    let fwdV: V3 = [0, 0, -1];

    const draw = (b: Batch | null, extra?: (u: Batch["uni"]) => void) => {
      if (!b || !b.count) return;
      gl.useProgram(b.prog);
      gl.uniform3f(b.uni.u_eye, eye[0], eye[1], eye[2]);
      gl.uniform3f(b.uni.u_right, rightV[0], rightV[1], rightV[2]);
      gl.uniform3f(b.uni.u_upv, upV[0], upV[1], upV[2]);
      gl.uniform3f(b.uni.u_fwd, fwdV[0], fwdV[1], fwdV[2]);
      gl.uniform1f(b.uni.u_fpx, fpx);
      gl.uniform2f(b.uni.u_res, w, h);
      gl.uniform1f(b.uni.u_dpr, dpr);
      gl.uniform1f(b.uni.u_time, t);
      gl.uniform1f(b.uni.u_motion, motion);
      extra?.(b.uni);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      for (const a of b.attribs) {
        if (a.loc < 0) continue;
        gl.enableVertexAttribArray(a.loc);
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, b.stride, a.offset);
      }
      gl.drawArrays(b.mode, 0, b.count);
      for (const a of b.attribs)
        if (a.loc >= 0) gl.disableVertexAttribArray(a.loc);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || !visibleRef.current) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t = (now - t0Ref.current) / 1000;

      // Auto-órbita tras 4s sin interacción (y sin selección).
      if (
        motion === 1 &&
        !selectedRef.current &&
        now - lastInteractRef.current > 4000
      )
        cam.yawT += dt * 0.07;

      // Disolución por anillo hacia su objetivo (1 = desintegrado, 0 = vivo).
      // Constante ~300ms: suficiente para LEER la desintegración, no un parpadeo.
      const fd = fadeRef.current;
      const kf = 1 - Math.exp(-dt * 3.2);
      for (let i = 0; i < 4; i++)
        fd[i] += ((i < zoomRef.current ? 1 : 0) - fd[i]) * kf;

      // Convergencia exponencial de todos los grados de libertad de la cámara.
      const k = 1 - Math.exp(-dt * 6);
      const dy = Math.atan2(Math.sin(cam.yawT - cam.yaw), Math.cos(cam.yawT - cam.yaw));
      cam.yaw += dy * k;
      cam.pitch += (cam.pitchT - cam.pitch) * k;
      cam.dist += (cam.distT - cam.dist) * k;
      cam.tx += (cam.txT - cam.tx) * k;
      cam.ty += (cam.tyT - cam.ty) * k;
      cam.tz += (cam.tzT - cam.tz) * k;

      // Base de la cámara (la misma para shaders y DOM).
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      eye = [
        cam.tx + cam.dist * cp * Math.sin(cam.yaw),
        cam.ty + cam.dist * sp,
        cam.tz + cam.dist * cp * Math.cos(cam.yaw),
      ];
      fwdV = norm(sub([cam.tx, cam.ty, cam.tz], eye));
      rightV = norm(cross(fwdV, [0, 1, 0]));
      upV = cross(rightV, fwdV);

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const setFade = (u: Batch["uni"]) =>
        gl.uniform4f(u.u_fade, fd[0], fd[1], fd[2], fd[3]);
      draw(bStars);
      draw(bGround);
      draw(bRings, setFade);
      draw(bEdges, setFade);
      draw(bFlow, setFade);
      draw(bSparks, setFade);
      const bu = burstRef.current;
      const bage = bu.t0 < 0 ? -1 : (now - bu.t0) / 700;
      if (bage >= 0 && bage < 1.05)
        draw(bBurst, (u) => {
          gl.uniform3f(u.u_bpos, bu.x, bu.y, bu.z);
          gl.uniform1f(u.u_bage, bage);
          gl.uniform1f(u.u_bgold, bu.gold);
        });
      draw(bBeam, (u) => {
        gl.uniform3f(u.u_apex, APEX[0], APEX[1], APEX[2]);
        gl.uniform1f(u.u_gold, winnerExists ? 1 : 0);
      });
      // Gemelas de partículas al final y con blending NORMAL: los chunks oscuros
      // del fondo de la caja deben tapar la escena (como la caja real), no sumar luz.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const zl = zoomRef.current;
      draw(bDiss, (u) => {
        setFade(u);
        gl.uniform1f(u.u_cardk, cardK);
        gl.uniform1f(u.u_chunk, chunkWorld);
        gl.uniform4f(
          u.u_dir,
          zl > 0 ? 1 : 0,
          zl > 1 ? 1 : 0,
          zl > 2 ? 1 : 0,
          zl > 3 ? 1 : 0
        );
      });
      gl.blendFunc(gl.ONE, gl.ONE);

      // Cajas DOM: proyectadas con la MISMA cámara, en el mismo frame.
      // Profundidad real: escala, orden (z-index) y atenuación por distancia.
      for (const n of nodesRef.current) {
        const el = nodeEls.current.get(n.slot);
        if (!el) continue;
        const rel: V3 = [n.wx - eye[0], n.wy - eye[1], n.wz - eye[2]];
        const vz = dot(rel, fwdV);
        // Anillo superado: a fade 0.13 la caja DOM se intercambia por su gemela
        // de chunks y son los chunks los que vuelan (no hay fadeout). La VUELTA
        // es asimétrica: sin chunks, la caja real reaparece con fade-in simple.
        const fade = n.round < 4 ? fd[n.round] : 0;
        const dissolving = n.round < zoomRef.current;
        if (vz < 0.15 || (dissolving ? fade > 0.13 : fade > 0.97)) {
          el.style.visibility = "hidden";
          continue;
        }
        const sx = w / 2 + (fpx * dot(rel, rightV)) / vz;
        const sy = h / 2 - (fpx * dot(rel, upV)) / vz;
        const isSel = selectedRef.current === n.slot;
        const s =
          Math.min(1.7, (cardK * fpx) / vz) *
          (isSel ? 1.05 : 1) *
          (n.round === 4 ? 1.15 : 1); // la cumbre pesa más
        if (!isSel && s < 0.14) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";
        el.style.transform = `translate3d(${sx.toFixed(2)}px, ${sy.toFixed(
          2
        )}px, 0) scale(${s.toFixed(3)}) translate(-50%, -50%)`;
        el.style.zIndex = String(
          isSel ? 980 : Math.max(1, Math.round(900 - vz * 140))
        );
        const depthOp = Math.min(1, Math.max(0.42, 1.3 - vz * 0.18));
        el.style.opacity = (
          (isSel ? 1 : depthOp) *
          (n.empty && !isSel ? 0.6 : 1) *
          (dissolving ? 1 : 1 - fade) // reapareciendo: fade-in puro
        ).toFixed(3);
      }

      // Auto-calidad: si el equipo no sostiene el frame budget, baja dpr/partículas.
      if (warmup > 0) warmup--;
      else if (!downgraded && quality > 0) {
        if (dt > 0.034) slowFrames++;
        else slowFrames = Math.max(0, slowFrames - 2);
        if (slowFrames > 45) {
          downgraded = true;
          setQuality((q) => (q > 0 ? ((q - 1) as 0 | 1 | 2) : q));
        }
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const b of batches) {
        if (!b) continue;
        gl.deleteBuffer(b.buf);
        gl.deleteProgram(b.prog);
      }
    };
  }, [nodes, w, h, fpx, quality, glEpoch, winnerExists]);

  // ---- gestos: orbitar (drag con inercia) + dolly (rueda/pellizco) ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    mode: "none" as "none" | "drag" | "pinch",
    lastX: 0, lastY: 0, lastT: 0, vyaw: 0,
    d0: 1, moved: 0,
  });

  const onPointerDown = (e: ReactPointerEvent) => {
    const st = stageRef.current;
    if (!st) return;
    lastInteractRef.current = performance.now();
    // OJO: no capturar aún — capturar en pointerdown redirige el click al stage
    // y mata la selección de nodos. Se captura recién al confirmar el arrastre.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.mode = "drag";
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      g.lastT = performance.now();
      g.vyaw = 0;
      g.moved = 0;
      st.style.cursor = "grabbing";
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      for (const id of pointers.current.keys()) st.setPointerCapture?.(id);
      g.mode = "pinch";
      g.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const c = camRef.current;
    const st = stageRef.current;
    lastInteractRef.current = performance.now();
    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      // Pellizco por umbral: al abrir/cerrar lo suficiente, sube/baja UN anillo.
      const ratio = d / g.d0;
      if (ratio > 1.35) {
        stepZoom(1);
        g.d0 = d;
      } else if (ratio < 1 / 1.35) {
        stepZoom(-1);
        g.d0 = d;
      }
      g.moved += 3;
    } else if (g.mode === "drag") {
      const now = performance.now();
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      const dyaw = -dx * 0.0055;
      c.yawT += dyaw;
      c.pitchT += dy * 0.0045;
      clampCam();
      const dt = Math.max(8, now - g.lastT) / 1000;
      g.lastT = now;
      g.vyaw = 0.8 * g.vyaw + 0.2 * (dyaw / dt);
      g.moved += Math.abs(dx) + Math.abs(dy);
      // Arrastre confirmado: capturar para no perder el gesto al salir del stage.
      if (g.moved > 6 && st && !st.hasPointerCapture?.(e.pointerId))
        st.setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const c = camRef.current;
    const st = stageRef.current;
    if (g.mode === "pinch" && pointers.current.size === 1) {
      const [a] = [...pointers.current.values()];
      g.mode = "drag";
      g.lastX = a.x;
      g.lastY = a.y;
      g.lastT = performance.now();
      g.vyaw = 0;
    } else if (pointers.current.size === 0) {
      if (g.mode === "drag") c.yawT += g.vyaw * 0.15; // inercia orbital al soltar
      g.mode = "none";
      if (st) st.style.cursor = "grab";
    }
  };

  // Rueda: un scroll = un anillo (paso discreto, como el radial clásico).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelLock.current) return; // throttle: un paso por gesto
      wheelLock.current = true;
      window.setTimeout(() => (wheelLock.current = false), 420);
      stepZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const clickSafe = () => gesture.current.moved < 8;
  const toggle = (slot: string) => {
    if (!clickSafe()) return;
    setSelected((s) => (s === slot ? null : slot));
  };
  const registerEl = (slot: string) => (el: HTMLDivElement | null) => {
    if (el) nodeEls.current.set(slot, el);
    else nodeEls.current.delete(slot);
  };

  // Goleadores del partido seleccionado (on-demand, igual que el radial clásico).
  const selNode = nodes.find((n) => n.slot === selected);
  const evId =
    selNode &&
    selNode.m.matchId.startsWith("ESPN-") &&
    (selNode.done || selNode.live)
      ? selNode.m.matchId.slice(5)
      : null;
  const { data: scorers } = useSWR<{ home: Scorer[]; away: Scorer[] }>(
    evId ? `/api/scorers?event=${evId}` : null,
    scorersFetcher,
    { refreshInterval: selNode?.live ? 20000 : 0 }
  );

  if (!rounds?.length)
    return <div className="loading">Aún no hay llaves disponibles.</div>;

  const finalNode = nodes.find((n) => n.round === 4);
  const champ = finalNode?.m;
  const winner =
    champ?.home.winner ? champ.home : champ?.away.winner ? champ.away : null;

  const upcoming = nodes
    .filter((n) => !n.done)
    .sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.m.utcDate.localeCompare(b.m.utcDate);
    })
    .slice(0, 14);

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
        <div className="radial-zoom">
          <button
            onClick={() => stepZoom(1)}
            disabled={zoomLevel >= 3}
            aria-label="Acercar una ronda"
          >
            +
          </button>
          <button
            onClick={() => stepZoom(-1)}
            disabled={zoomLevel <= 0}
            aria-label="Alejar una ronda"
          >
            −
          </button>
          <button onClick={resetCamera} aria-label="Reiniciar vista">
            ⌂
          </button>
        </div>
        <div
          className="r2-stage"
          ref={stageRef}
          style={{ width: w, height: h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={resetCamera}
          onClick={() => clickSafe() && setSelected(null)}
        >
          <canvas ref={canvasRef} style={{ width: w, height: h }} />
          <div className="r2-layer">
            {nodes
              .filter((n) => n.round !== 4)
              .map((n) => (
                <R2Node
                  key={n.slot}
                  n={n}
                  active={n.slot === selected}
                  onSelect={toggle}
                  refCb={registerEl(n.slot)}
                  scorers={n.slot === selected ? scorers : undefined}
                />
              ))}
            {finalNode && (
              <FinalSummit
                n={finalNode}
                winner={winner}
                active={finalNode.slot === selected}
                onSelect={toggle}
                refCb={registerEl(finalNode.slot)}
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
            <span className="hint">
              Rueda o pellizco: sube una ronda (el anillo se desintegra) · arrastra
              para orbitar · doble toque reinicia
            </span>
          </div>
        )}
      </div>

      {/* Panel lateral: próximos partidos por fecha (mismo look que el clásico) */}
      <aside className="radial-side" hidden={fs}>
        <h3 className="rs-title">Próximos partidos</h3>
        <div className="rs-list">
          {upcoming.map((n) => (
            <button
              key={n.slot}
              className={`rs-item ${n.live ? "live" : ""} ${
                n.slot === selected ? "sel" : ""
              } ${n.empty ? "empty" : ""}`}
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
      {t.code && <Flag value={t.flag} size={13} />}
      <span className="rs-tcode">{t.code ?? "—"}</span>
      {t.score != null && <span className="rs-tsc">{t.score}</span>}
    </span>
  );
}

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

// La final en la cumbre: trofeo flotando sobre la caja, campeón debajo.
function FinalSummit({
  n,
  winner,
  active,
  onSelect,
  refCb,
  scorers,
}: {
  n: Node;
  winner: BTeam | null;
  active: boolean;
  onSelect: (slot: string) => void;
  refCb: (el: HTMLDivElement | null) => void;
  scorers?: { home: Scorer[]; away: Scorer[] };
}) {
  const cls = n.live ? "live" : n.done ? "done" : "tbd";
  const row = (t: BTeam) => (
    <div className={`rf-row ${t.winner ? "win" : ""} ${t.lost ? "lose" : ""}`}>
      {t.code && <Flag value={t.flag} size={18} />}
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
      className="radial-center r2-3d"
      ref={refCb}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(n.slot);
      }}
    >
      <div className="radial-trophy">🏆</div>
      <div
        className={`radial-final stage-FINAL ${cls} ${active ? "active" : ""} ${
          n.empty ? "empty" : ""
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

function R2Node({
  n,
  active,
  onSelect,
  refCb,
  scorers,
}: {
  n: Node;
  active: boolean;
  onSelect: (slot: string) => void;
  refCb: (el: HTMLDivElement | null) => void;
  scorers?: { home: Scorer[]; away: Scorer[] };
}) {
  // Tras la animación de crecer, "settled" libera el overflow para mostrar goles.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) return setSettled(false);
    const t = setTimeout(() => setSettled(true), 460);
    return () => clearTimeout(t);
  }, [active]);

  const cls = n.live ? "live" : n.done ? "done" : "tbd";

  const chipSide = (t: BTeam) => (
    <div
      className={`rn-team ${t.winner ? "win" : ""} ${t.lost ? "lose" : ""} ${
        t.provisional ? "prov" : ""
      }`}
    >
      {t.code && <Flag value={t.flag} size={14} />}
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
      {t.code && <Flag value={t.flag} size={15} />}
      <span className="rx-name">{t.code ? t.name : t.placeholder}</span>
      <span className="rx-sc">
        {t.score ?? "–"}
        {t.pens != null && <span className="rn-pen"> ({t.pens})</span>}
      </span>
    </div>
  );

  return (
    <div
      className={`radial-node r2n r2-3d stage-${n.m.stage} ${cls} ${
        active ? "active" : ""
      } ${settled ? "settled" : ""} ${n.empty ? "empty" : ""}`}
      ref={refCb}
      onClick={(e) => {
        e.stopPropagation();
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
