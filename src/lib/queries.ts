import { computeStandings } from "./standings";
import { buildBracket } from "./bracket";
import { fetchWorldCup as fetchEspn } from "./providers/espn";
import { fetchWorldCup as fetchFootballData } from "./providers/footballData";
import { fetchWorldCup as fetchApiFootball } from "./providers/apiFootball";
import type { MatchDoc, TeamDoc } from "./types";

// Sin base de datos: se consulta el proveedor (ESPN por defecto) y se cachea en
// memoria por DATA_TTL_SECONDS (30s). Así el origen recibe ~1 request cada 30s
// sin importar cuántos visitantes haya -> sin problemas de límites de API.
const TTL_MS = (() => {
  const s = Number(process.env.DATA_TTL_SECONDS ?? "30");
  return Number.isFinite(s) && s > 0 ? s * 1000 : 30_000;
})();

type Snapshot = { teams: TeamDoc[]; matches: MatchDoc[] };
let cache: Snapshot | null = null;
let cacheAt = 0;
let inflight: Promise<Snapshot> | null = null;

async function fetchSource(): Promise<Snapshot> {
  const src = process.env.DATA_SOURCE?.trim() || "espn";
  if (src === "api-football") {
    const k = process.env.API_FOOTBALL_KEY?.trim();
    if (!k) throw new Error("Falta API_FOOTBALL_KEY");
    return fetchApiFootball(k);
  }
  if (src === "football-data.org") {
    const k = process.env.FOOTBALL_DATA_API_KEY?.trim();
    if (!k) throw new Error("Falta FOOTBALL_DATA_API_KEY");
    return fetchFootballData(k);
  }
  return fetchEspn();
}

export async function load(force = false): Promise<Snapshot> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL_MS) return cache;
  if (inflight) return inflight; // colapsa peticiones concurrentes
  inflight = (async () => {
    try {
      const data = await fetchSource();
      if (data.matches.length) {
        cache = data;
        cacheAt = Date.now();
      }
      return cache ?? data;
    } catch (e) {
      if (cache) return cache; // ante error, sirve lo último bueno
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function getStandings() {
  const { teams, matches } = await load();
  return computeStandings(teams, matches);
}

export async function getBracket() {
  const { teams, matches } = await load();
  return buildBracket(teams, matches);
}

// Partidos en vivo + próximos + recientes para el ticker.
export async function getMatchFeed() {
  const { teams, matches } = await load();
  const flagOf = new Map(teams.map((t) => [t.code, t]));
  const decorate = (m: MatchDoc) => ({
    matchId: m.matchId,
    stage: m.stage,
    group: m.group,
    status: m.status,
    minute: m.minute,
    utcDate: m.utcDate,
    venue: m.venue,
    home: {
      code: m.homeCode,
      name: m.homeCode ? flagOf.get(m.homeCode)?.name ?? m.homeCode : m.homePlaceholder,
      flag: m.homeCode ? flagOf.get(m.homeCode)?.flag ?? "🏳️" : "⏳",
      score: m.homeScore,
      pens: m.homePens,
    },
    away: {
      code: m.awayCode,
      name: m.awayCode ? flagOf.get(m.awayCode)?.name ?? m.awayCode : m.awayPlaceholder,
      flag: m.awayCode ? flagOf.get(m.awayCode)?.flag ?? "🏳️" : "⏳",
      score: m.awayScore,
      pens: m.awayPens,
    },
  });

  const live = matches
    .filter((m) => m.status === "LIVE" || m.status === "PAUSED")
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate))
    .map(decorate);

  const upcoming = matches
    .filter((m) => m.status === "SCHEDULED")
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate))
    .slice(0, 8)
    .map(decorate);

  const recent = matches
    .filter((m) => m.status === "FINISHED")
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))
    .slice(0, 8)
    .map(decorate);

  return { live, upcoming, recent };
}
