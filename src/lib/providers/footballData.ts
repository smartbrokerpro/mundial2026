import type { MatchDoc, MatchStatus, Stage, TeamDoc } from "../types";
import { TEAM_BY_CODE } from "../data/teams2026";

// Provider de football-data.org (competición WC). Free tier: 10 req/min, header X-Auth-Token.
// Doc: https://www.football-data.org/documentation/api
const BASE = "https://api.football-data.org/v4";

const STAGE_MAP: Record<string, Stage> = {
  GROUP_STAGE: "GROUP_STAGE",
  LAST_32: "LAST_32",
  ROUND_OF_32: "LAST_32",
  LAST_16: "LAST_16",
  ROUND_OF_16: "LAST_16",
  QUARTER_FINALS: "QUARTER_FINALS",
  QUARTER_FINAL: "QUARTER_FINALS",
  SEMI_FINALS: "SEMI_FINALS",
  SEMI_FINAL: "SEMI_FINALS",
  THIRD_PLACE: "THIRD_PLACE",
  FINAL: "FINAL",
};

const KO_ORDER: Stage[] = [
  "LAST_32",
  "LAST_16",
  "QUARTER_FINALS",
  "SEMI_FINALS",
  "FINAL",
];

function mapStatus(s: string): MatchStatus {
  switch (s) {
    case "IN_PLAY":
      return "LIVE";
    case "PAUSED":
      return "PAUSED";
    case "FINISHED":
    case "AWARDED":
      return "FINISHED";
    default:
      return "SCHEDULED";
  }
}

// Intenta mapear el nombre/tla de la API a una bandera emoji conocida; si no, genérica.
function flagFor(tla: string | null, name: string): string {
  if (tla && TEAM_BY_CODE.has(tla)) return TEAM_BY_CODE.get(tla)!.flag;
  const byName = [...TEAM_BY_CODE.values()].find(
    (t) => t.name.toLowerCase() === name?.toLowerCase()
  );
  return byName?.flag ?? "🏳️";
}

interface RawTeam {
  id: number | null;
  name: string | null;
  tla: string | null;
}
interface RawMatch {
  id: number;
  utcDate: string;
  status: string;
  stage: string;
  group: string | null;
  homeTeam: RawTeam;
  awayTeam: RawTeam;
  score: {
    fullTime: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  };
}

export async function fetchWorldCup(apiKey: string): Promise<{
  teams: TeamDoc[];
  matches: MatchDoc[];
}> {
  const res = await fetch(`${BASE}/competitions/WC/matches`, {
    headers: { "X-Auth-Token": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `football-data.org respondió ${res.status}: ${await res.text()}`
    );
  }
  const data = (await res.json()) as { matches: RawMatch[] };
  return normalize(data.matches || []);
}

function normalize(raw: RawMatch[]): { teams: TeamDoc[]; matches: MatchDoc[] } {
  const teams = new Map<string, TeamDoc>();

  const codeOf = (t: RawTeam): string | null => {
    if (!t || (!t.tla && !t.name)) return null;
    return t.tla || t.name!.slice(0, 3).toUpperCase();
  };

  const registerTeam = (t: RawTeam, group: string | null) => {
    const code = codeOf(t);
    if (!code) return;
    const grp = group?.replace(/^Group\s+/i, "") ?? null;
    const existing = teams.get(code);
    if (existing) {
      if (grp && !existing.group) existing.group = grp;
      return;
    }
    teams.set(code, {
      code,
      name: t.name || code,
      flag: flagFor(t.tla, t.name || ""),
      group: grp,
    });
  };

  // Indexa partidos de eliminación por etapa para asignar slots y enlaces.
  const koByStage = new Map<Stage, RawMatch[]>();

  const matches: MatchDoc[] = raw.map((m) => {
    const stage = STAGE_MAP[m.stage] ?? "GROUP_STAGE";
    registerTeam(m.homeTeam, m.group);
    registerTeam(m.awayTeam, m.group);
    if (stage !== "GROUP_STAGE") {
      if (!koByStage.has(stage)) koByStage.set(stage, []);
      koByStage.get(stage)!.push(m);
    }
    return {
      matchId: `FD-${m.id}`,
      stage,
      group: m.group?.replace(/^Group\s+/i, "") ?? null,
      slot: `FD-${m.id}`,
      nextSlot: null,
      homePlaceholder: m.homeTeam?.name ?? "Por definir",
      awayPlaceholder: m.awayTeam?.name ?? "Por definir",
      homeCode: codeOf(m.homeTeam),
      awayCode: codeOf(m.awayTeam),
      homeScore: m.score?.fullTime?.home ?? null,
      awayScore: m.score?.fullTime?.away ?? null,
      homePens: m.score?.penalties?.home ?? null,
      awayPens: m.score?.penalties?.away ?? null,
      status: mapStatus(m.status),
      minute: null,
      utcDate: m.utcDate,
      venue: "",
    };
  });

  // Asigna slots ordenados por fecha y enlaza cada partido con la ronda siguiente.
  const slotIndex = new Map<string, string>(); // matchId -> slot
  KO_ORDER.forEach((stage) => {
    const list = (koByStage.get(stage) || []).sort((a, b) =>
      a.utcDate.localeCompare(b.utcDate)
    );
    list.forEach((m, i) => {
      const prefix =
        stage === "LAST_32"
          ? "R32"
          : stage === "LAST_16"
          ? "R16"
          : stage === "QUARTER_FINALS"
          ? "QF"
          : stage === "SEMI_FINALS"
          ? "SF"
          : "FINAL";
      slotIndex.set(`FD-${m.id}`, `${prefix}-${i + 1}`);
    });
  });

  const stageOfMatch = new Map(matches.map((m) => [m.matchId, m.stage]));
  for (const m of matches) {
    if (m.stage === "GROUP_STAGE") continue;
    const slot = slotIndex.get(m.matchId);
    if (slot) m.slot = slot;
    const idx = KO_ORDER.indexOf(m.stage);
    const nextStage = KO_ORDER[idx + 1];
    if (nextStage && slot) {
      const n = parseInt(slot.split("-")[1], 10);
      const nextPrefix =
        nextStage === "LAST_16"
          ? "R16"
          : nextStage === "QUARTER_FINALS"
          ? "QF"
          : nextStage === "SEMI_FINALS"
          ? "SF"
          : "FINAL";
      m.nextSlot = `${nextPrefix}-${Math.ceil(n / 2)}`;
    }
    void stageOfMatch;
  }

  return { teams: [...teams.values()], matches };
}
