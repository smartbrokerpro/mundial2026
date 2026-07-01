"use client";

import Flag from "./Flag";

interface Row {
  code: string;
  name: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gd: number;
  points: number;
  rank: number;
}
interface Group {
  group: string;
  rows: Row[];
}

export default function Groups({ groups }: { groups: Group[] }) {
  if (!groups?.length) return <div className="loading">Sin datos de grupos.</div>;
  return (
    <div className="groups-grid">
      {groups.map((g) => (
        <div className="group-card" key={g.group}>
          <h3>
            Grupo <span>{g.group}</span>
          </h3>
          <div className="gtable">
            <div className="grow ghead">
              <span className="gname">Equipo</span>
              <span>PJ</span>
              <span>DG</span>
              <span>Pts</span>
            </div>
            {g.rows.map((r) => (
              <div
                key={r.code}
                className={`grow ${
                  r.rank <= 2 ? `qualed ${r.rank === 2 ? "r2" : ""}` : ""
                }`}
              >
                <span className="gname">
                  <Flag value={r.flag} size={18} />
                  <span className="tn-name">{r.name}</span>
                </span>
                <span>{r.played}</span>
                <span>{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
                <span className="pts">{r.points}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
