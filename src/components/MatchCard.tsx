"use client";

import Flag from "./Flag";
import Broadcaster from "./Broadcaster";
import { countdown } from "@/lib/time";

interface Side {
  code: string | null;
  name: string;
  flag: string;
  score: number | null;
  pens: number | null;
}
export interface FeedMatch {
  matchId: string;
  stage: string;
  group: string | null;
  status: string;
  minute: number | null;
  utcDate: string;
  venue: string;
  home: Side;
  away: Side;
}

const STAGE_ES: Record<string, string> = {
  GROUP_STAGE: "Fase de grupos",
  LAST_32: "Dieciseisavos",
  LAST_16: "Octavos",
  QUARTER_FINALS: "Cuartos",
  SEMI_FINALS: "Semifinal",
  THIRD_PLACE: "3er puesto",
  FINAL: "Final",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchCard({ m }: { m: FeedMatch }) {
  const live = m.status === "LIVE" || m.status === "PAUSED";
  const finished = m.status === "FINISHED";
  const tag = m.group ? `Grupo ${m.group}` : STAGE_ES[m.stage] ?? m.stage;
  return (
    <div className={`match-card ${live ? "islive" : ""}`}>
      <div className="meta">
        <span>
          {tag}
          <Broadcaster home={m.home.code} away={m.away.code} stage={m.stage} />
        </span>
        {live ? (
          <span className="live-min">● {m.minute ?? 0}&apos;</span>
        ) : finished ? (
          <span>Final</span>
        ) : (
          <span>{fmtDate(m.utcDate)}</span>
        )}
      </div>
      {[m.home, m.away].map((s, i) => (
        <div className="row" key={i}>
          <span className="team">
            <Flag value={s.flag} />
            {s.name}
          </span>
          <span className="score">
            {s.score ?? "–"}
            {s.pens != null && <span className="pens">({s.pens})</span>}
          </span>
        </div>
      ))}
      {!live && !finished && countdown(m.utcDate) && (
        <div className="mc-when">⏱ Comienza {countdown(m.utcDate)}</div>
      )}
    </div>
  );
}
