import { dbConnect } from "./mongodb";
import { Team, Match } from "./models";
import { fetchWorldCup as fetchFootballData } from "./providers/footballData";
import { fetchWorldCup as fetchApiFootball } from "./providers/apiFootball";
import { fetchWorldCup as fetchEspn } from "./providers/espn";

type Source = "espn" | "api-football" | "football-data.org";

export interface SyncResult {
  ok: boolean;
  source: Source;
  teams: number;
  matches: number;
  message: string;
}

// Elige el provider con DATA_SOURCE (por defecto "espn": gratis, sin key, 2026 en vivo).
// "api-football" y "football-data" requieren su key (planes con acceso a la temporada actual).
export async function syncFromProvider(): Promise<SyncResult> {
  const source = (process.env.DATA_SOURCE?.trim() || "espn") as Source;

  await dbConnect();
  let teams, matches;

  if (source === "api-football") {
    const key = process.env.API_FOOTBALL_KEY?.trim();
    if (!key) throw new Error("DATA_SOURCE=api-football pero falta API_FOOTBALL_KEY");
    ({ teams, matches } = await fetchApiFootball(key));
  } else if (source === "football-data.org") {
    const key = process.env.FOOTBALL_DATA_API_KEY?.trim();
    if (!key) throw new Error("DATA_SOURCE=football-data.org pero falta FOOTBALL_DATA_API_KEY");
    ({ teams, matches } = await fetchFootballData(key));
  } else {
    // ESPN (default) — no necesita key.
    ({ teams, matches } = await fetchEspn());
  }
  if (matches.length === 0) {
    return {
      ok: false,
      source,
      teams: 0,
      matches: 0,
      message: `${source} no devolvió partidos para el Mundial 2026.`,
    };
  }

  await Promise.all([Team.deleteMany({}), Match.deleteMany({})]);
  await Team.insertMany(teams);
  await Match.insertMany(matches);

  return {
    ok: true,
    source,
    teams: teams.length,
    matches: matches.length,
    message: `Sincronizado desde ${source}: ${teams.length} equipos, ${matches.length} partidos.`,
  };
}
