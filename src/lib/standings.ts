import type {
  GroupStanding,
  MatchDoc,
  StandingRow,
  TeamDoc,
} from "./types";

// Calcula la tabla de posiciones de cada grupo a partir de los partidos jugados.
// Criterios FIFA simplificados: puntos > diferencia de gol > goles a favor > nombre.
export function computeStandings(
  teams: TeamDoc[],
  matches: MatchDoc[]
): GroupStanding[] {
  const groups = new Map<string, Map<string, StandingRow>>();

  // Inicializa filas por equipo agrupado.
  for (const t of teams) {
    if (!t.group) continue;
    if (!groups.has(t.group)) groups.set(t.group, new Map());
    groups.get(t.group)!.set(t.code, {
      code: t.code,
      name: t.name,
      flag: t.flag,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
      rank: 0,
    });
  }

  const groupMatches = matches.filter(
    (m) =>
      m.stage === "GROUP_STAGE" &&
      m.status === "FINISHED" &&
      m.homeCode &&
      m.awayCode &&
      m.homeScore != null &&
      m.awayScore != null
  );

  for (const m of groupMatches) {
    const g = m.group!;
    const table = groups.get(g);
    if (!table) continue;
    const home = table.get(m.homeCode!);
    const away = table.get(m.awayCode!);
    if (!home || !away) continue;

    const hs = m.homeScore!;
    const as = m.awayScore!;
    home.played++;
    away.played++;
    home.gf += hs;
    home.ga += as;
    away.gf += as;
    away.ga += hs;

    if (hs > as) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (hs < as) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
    }
  }

  const result: GroupStanding[] = [];
  for (const [group, table] of [...groups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const rows = [...table.values()];
    for (const r of rows) r.gd = r.gf - r.ga;
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.gd - a.gd ||
        b.gf - a.gf ||
        a.name.localeCompare(b.name)
    );
    rows.forEach((r, i) => (r.rank = i + 1));
    result.push({ group, rows });
  }
  return result;
}
