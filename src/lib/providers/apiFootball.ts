import type { MatchDoc, MatchStatus, Stage, TeamDoc } from "../types";

// Provider de API-Football (API-Sports v3). Mundial 2026 = league 1, season 2026.
// Header: x-apisports-key. Free tier: 100 req/día. Doc: https://api-sports.io/documentation/football/v3
const BASE = "https://v3.football.api-sports.io";

const STAGE_MAP: { test: (round: string) => boolean; stage: Stage }[] = [
  { test: (r) => /group/i.test(r), stage: "GROUP_STAGE" },
  { test: (r) => /round of 32|1\/16/i.test(r), stage: "LAST_32" },
  { test: (r) => /round of 16|1\/8/i.test(r), stage: "LAST_16" },
  { test: (r) => /quarter/i.test(r), stage: "QUARTER_FINALS" },
  { test: (r) => /semi/i.test(r), stage: "SEMI_FINALS" },
  { test: (r) => /3rd place|third place/i.test(r), stage: "THIRD_PLACE" },
  { test: (r) => /final/i.test(r), stage: "FINAL" },
];

const KO_ORDER: Stage[] = [
  "LAST_32",
  "LAST_16",
  "QUARTER_FINALS",
  "SEMI_FINALS",
  "FINAL",
];
const KO_PREFIX: Record<string, string> = {
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

function mapStage(round: string): Stage {
  for (const r of STAGE_MAP) if (r.test(round)) return r.stage;
  return "GROUP_STAGE";
}

function mapStatus(short: string): MatchStatus {
  if (["HT", "BT"].includes(short)) return "PAUSED";
  if (["1H", "2H", "ET", "P", "LIVE", "INT"].includes(short)) return "LIVE";
  if (["FT", "AET", "PEN", "AWD", "WO"].includes(short)) return "FINISHED";
  return "SCHEDULED";
}

async function get<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
  });
  const json = await res.json();
  const errs = json?.errors;
  if (errs && ((Array.isArray(errs) && errs.length) || Object.keys(errs).length)) {
    throw new Error(`API-Football error: ${JSON.stringify(errs)}`);
  }
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  return json.response as T;
}

interface RawStandingRow {
  rank: number;
  team: { id: number; name: string; logo: string };
  group: string;
}
interface RawStandings {
  league: { standings: RawStandingRow[][] };
}
interface RawFixture {
  fixture: {
    id: number;
    date: string;
    venue: { name: string | null; city: string | null };
    status: { short: string; elapsed: number | null };
  };
  league: { round: string };
  teams: { home: RawTeamRef; away: RawTeamRef };
  goals: { home: number | null; away: number | null };
  score: { penalty: { home: number | null; away: number | null } };
}
interface RawTeamRef {
  id: number | null;
  name: string | null;
  logo: string | null;
}

export async function fetchWorldCup(apiKey: string): Promise<{
  teams: TeamDoc[];
  matches: MatchDoc[];
}> {
  const [standings, fixtures] = await Promise.all([
    get<RawStandings[]>("/standings?league=1&season=2026", apiKey).catch(
      () => [] as RawStandings[]
    ),
    get<RawFixture[]>("/fixtures?league=1&season=2026", apiKey),
  ]);

  const teams = new Map<string, TeamDoc>();
  const groupOfTeam = new Map<string, string>();

  // Equipos y grupos desde /standings (tabla oficial de la API).
  const groups = standings[0]?.league?.standings ?? [];
  for (const group of groups) {
    for (const row of group) {
      const code = String(row.team.id);
      const letter = row.group?.replace(/^Group\s+/i, "") ?? null;
      groupOfTeam.set(code, letter ?? "");
      teams.set(code, {
        code,
        name: row.team.name,
        flag: row.team.logo, // URL del escudo
        group: letter,
      });
    }
  }

  const codeOf = (t: RawTeamRef) => (t?.id != null ? String(t.id) : null);
  const ensureTeam = (t: RawTeamRef) => {
    const code = codeOf(t);
    if (!code || teams.has(code)) return;
    teams.set(code, {
      code,
      name: t.name || code,
      flag: t.logo || "🏳️",
      group: groupOfTeam.get(code) || null,
    });
  };

  const koByStage = new Map<Stage, RawFixture[]>();
  const matches: MatchDoc[] = fixtures.map((f) => {
    const stage = mapStage(f.league.round);
    ensureTeam(f.teams.home);
    ensureTeam(f.teams.away);
    if (stage !== "GROUP_STAGE") {
      if (!koByStage.has(stage)) koByStage.set(stage, []);
      koByStage.get(stage)!.push(f);
    }
    const homeCode = codeOf(f.teams.home);
    const venue = [f.fixture.venue?.name, f.fixture.venue?.city]
      .filter(Boolean)
      .join(" · ");
    return {
      matchId: `AF-${f.fixture.id}`,
      stage,
      group:
        stage === "GROUP_STAGE" && homeCode
          ? groupOfTeam.get(homeCode) || null
          : null,
      slot: `AF-${f.fixture.id}`,
      nextSlot: null,
      homePlaceholder: f.teams.home?.name ?? "Por definir",
      awayPlaceholder: f.teams.away?.name ?? "Por definir",
      homeCode,
      awayCode: codeOf(f.teams.away),
      homeScore: f.goals?.home ?? null,
      awayScore: f.goals?.away ?? null,
      homePens: f.score?.penalty?.home ?? null,
      awayPens: f.score?.penalty?.away ?? null,
      status: mapStatus(f.fixture.status.short),
      minute: f.fixture.status.elapsed ?? null,
      utcDate: f.fixture.date,
      venue,
    };
  });

  // Asigna slots por etapa (ordenados por fecha) y enlaza con la ronda siguiente.
  const slotOf = new Map<string, string>();
  for (const stage of KO_ORDER) {
    const list = (koByStage.get(stage) || []).sort((a, b) =>
      a.fixture.date.localeCompare(b.fixture.date)
    );
    list.forEach((f, i) => slotOf.set(`AF-${f.fixture.id}`, `${KO_PREFIX[stage]}-${i + 1}`));
  }
  for (const m of matches) {
    if (m.stage === "GROUP_STAGE") continue;
    const slot = slotOf.get(m.matchId);
    if (slot) m.slot = slot;
    const nextStage = KO_ORDER[KO_ORDER.indexOf(m.stage) + 1];
    if (nextStage && slot) {
      const n = parseInt(slot.split("-")[1], 10);
      m.nextSlot = `${KO_PREFIX[nextStage]}-${Math.ceil(n / 2)}`;
    }
  }

  return { teams: [...teams.values()], matches };
}
