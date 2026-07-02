"use client";

import { useLayoutEffect, useRef, useState, useCallback } from "react";
import Flag from "./Flag";
import Broadcaster from "./Broadcaster";
import { countdown } from "@/lib/time";

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
interface Line {
  d: string;
  live: boolean;
  anim: boolean;
}

function TeamRow({ t }: { t: BTeam }) {
  const tbd = !t.code;
  return (
    <div className="brow">
      <span
        className={`bteam ${tbd ? "tbd" : ""} ${t.winner ? "win" : ""} ${
          t.lost ? "lose" : ""
        } ${t.provisional ? "prov" : ""}`}
      >
        {!tbd && <Flag value={t.flag} size={18} />}
        {tbd ? t.placeholder : t.name}
        {t.provisional && <span className="prov-tag" title="Proyectado por el resultado en vivo">▲ en vivo</span>}
      </span>
      {!tbd && t.score != null && (
        <span className="bsc">
          {t.score}
          {t.pens != null && <span className="pens"> ({t.pens})</span>}
        </span>
      )}
    </div>
  );
}

export default function Bracket({ rounds }: { rounds: Round[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);

  const setCard = useCallback(
    (slot: string) => (el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(slot, el);
      else cardRefs.current.delete(slot);
    },
    []
  );

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const next: Line[] = [];
    for (const round of rounds) {
      for (const m of round.matches) {
        if (!m.nextSlot) continue;
        const from = cardRefs.current.get(m.slot);
        const to = cardRefs.current.get(m.nextSlot);
        if (!from || !to) continue;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.right - base.left;
        const y1 = a.top - base.top + a.height / 2;
        const x2 = b.left - base.left;
        const y2 = b.top - base.top + b.height / 2;
        const mx = x1 + (x2 - x1) / 2;
        const live = m.status === "LIVE" || m.status === "PAUSED";
        // Partido resuelto -> línea estática; futuro o en vivo -> animada.
        const anim = m.status !== "FINISHED";
        next.push({
          d: `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`,
          live,
          anim,
        });
      }
    }
    setLines(next);
  }, [rounds]);

  useLayoutEffect(() => {
    recompute();
    const ro = new ResizeObserver(recompute);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  if (!rounds?.length)
    return <div className="loading">Aún no hay llaves disponibles.</div>;

  return (
    <div className="bracket-wrap">
      <div className="bracket" ref={wrapRef} style={{ position: "relative" }}>
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
            zIndex: 0,
          }}
        >
          {lines.map((l, i) => (
            <path
              key={i}
              d={l.d}
              fill="none"
              className={l.anim ? `flow ${l.live ? "live" : ""}` : ""}
              stroke={
                l.live
                  ? "var(--live)"
                  : l.anim
                  ? "var(--accent-2)"
                  : "var(--border)"
              }
              strokeWidth={l.live ? 2.2 : l.anim ? 1.8 : 1.4}
            />
          ))}
        </svg>

        {rounds.map((round) => {
          const isFinal = round.stage === "FINAL";
          return (
            <div
              className={`round ${isFinal ? "final-col" : ""}`}
              key={round.stage}
              style={{ position: "relative", zIndex: 1 }}
            >
              <div className="round-head">{round.title}</div>
              <div className="round-body">
                {round.matches.map((m) => {
                  const live = m.status === "LIVE" || m.status === "PAUSED";
                  return (
                    <div
                      className={`bm ${live ? "islive" : ""} ${
                        m.status === "FINISHED" ? "played" : ""
                      } ${isFinal ? "final-match" : ""} ${
                        !m.home.code && !m.away.code ? "empty" : ""
                      }`}
                      key={m.matchId}
                      ref={setCard(m.slot)}
                    >
                      {isFinal && <div className="trophy">🏆</div>}
                      <TeamRow t={m.home} />
                      <TeamRow t={m.away} />
                      <div className="label">
                        <span className="lbl-slot">
                          {m.slot}
                          <Broadcaster
                            home={m.home.code}
                            away={m.away.code}
                            stage={m.stage}
                            size={12}
                          />
                        </span>
                        {live ? (
                          <span className="lv">● {m.minute ?? 0}&apos;</span>
                        ) : m.status === "FINISHED" ? (
                          <span>Final</span>
                        ) : (
                          <span>{countdown(m.utcDate) || "Por jugar"}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
