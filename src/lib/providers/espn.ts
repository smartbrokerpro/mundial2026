import type { MatchDoc, MatchStatus, Stage, TeamDoc } from "../types";

// Provider de la API pública (no oficial) de ESPN — gratis, sin key, datos reales del
// Mundial 2026 en vivo. Slug de liga: fifa.world.
// scoreboard: todos los partidos en un rango de fechas. standings: grupos.
const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const CORE = "https://site.api.espn.com/apis/v2/sports/soccer/fifa.world";
// Ventana del torneo (11 jun – 19 jul 2026). Configurable por env.
const DATES = process.env.ESPN_DATES || "20260611-20260719";

const STAGE_MAP: Record<string, Stage> = {
  "group-stage": "GROUP_STAGE",
  "round-of-32": "LAST_32",
  "round-of-16": "LAST_16",
  quarterfinals: "QUARTER_FINALS",
  semifinals: "SEMI_FINALS",
  "3rd-place-match": "THIRD_PLACE",
  final: "FINAL",
};

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

function mapStatus(state: string, detail: string): MatchStatus {
  if (state === "post") return "FINISHED";
  if (state === "in") return /half|ht/i.test(detail) ? "PAUSED" : "LIVE";
  return "SCHEDULED";
}

function parseMinute(clock: string | undefined, detail: string): number | null {
  const src = clock || detail || "";
  const m = src.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Traduce los placeholders de ESPN ("Round of 16 1 Winner") al español.
function prettyPlaceholder(name: string): string {
  return name
    .replace(/Round of 32 (\d+) Winner/i, "Ganador Dieciseisavos $1")
    .replace(/Round of 16 (\d+) Winner/i, "Ganador Octavos $1")
    .replace(/Quarterfinal (\d+) Winner/i, "Ganador Cuartos $1")
    .replace(/Semifinal (\d+) Winner/i, "Ganador Semifinal $1")
    .replace(/(\d+)(?:st|nd|rd|th) Place Group ([A-L])/i, "$1º Grupo $2")
    .replace(/Winner Group ([A-L])/i, "1º Grupo $1")
    .replace(/Runner-?up Group ([A-L])/i, "2º Grupo $1");
}

interface RawCompetitor {
  homeAway: "home" | "away";
  score?: string;
  shootoutScore?: number | string;
  winner?: boolean;
  team: { displayName: string; abbreviation: string; logo?: string };
}
interface RawEvent {
  id: string;
  date: string;
  season?: { slug?: string };
  competitions: {
    notes?: { headline?: string }[];
    venue?: { fullName?: string; address?: { city?: string } };
    status: {
      displayClock?: string;
      type: { state: string; detail: string };
    };
    competitors: RawCompetitor[];
  }[];
}

async function getJSON(url: string) {
  // Caché de datos de Next: ESPN se consulta a lo sumo ~cada 30s (compartido).
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status} (${url})`);
  return res.json();
}

export async function fetchWorldCup(): Promise<{
  teams: TeamDoc[];
  matches: MatchDoc[];
}> {
  const [scoreboard, standings] = await Promise.all([
    getJSON(`${SITE}/scoreboard?dates=${DATES}&limit=400`),
    getJSON(`${CORE}/standings`).catch(() => null),
  ]);

  const teams = new Map<string, TeamDoc>();
  const groupOf = new Map<string, string>();

  // Grupos y equipos desde standings.
  for (const group of standings?.children ?? []) {
    const letter = (group.name || "").replace(/^Group\s+/i, "") || null;
    for (const entry of group.standings?.entries ?? []) {
      const t = entry.team;
      const code = (t.abbreviation || t.displayName).toUpperCase();
      if (letter) groupOf.set(code, letter);
      teams.set(code, {
        code,
        name: t.displayName,
        flag: t.logo || t.logos?.[0]?.href || "🏳️",
        group: letter,
      });
    }
  }

  const codeOf = (c: RawCompetitor) =>
    (c.team.abbreviation || c.team.displayName).toUpperCase();

  // Equipos reales = los de standings (48). En llaves sin definir, ESPN manda
  // "equipos" placeholder ("Round of 16 1 Winner"): los tratamos como TBD (code null).
  const realCodes = new Set(teams.keys());
  const noStandings = realCodes.size === 0; // fallback si standings falló
  const ensureTeam = (c: RawCompetitor) => {
    const code = codeOf(c);
    if (teams.has(code)) return;
    teams.set(code, {
      code,
      name: c.team.displayName,
      flag: c.team.logo || "🏳️",
      group: groupOf.get(code) || null,
    });
  };
  // Devuelve el código si es un equipo real (ya definido), o null si es placeholder.
  const resolve = (c: RawCompetitor): string | null => {
    const code = codeOf(c);
    if (noStandings) {
      ensureTeam(c);
      return code;
    }
    return realCodes.has(code) ? code : null;
  };

  const events: RawEvent[] = scoreboard.events ?? [];
  const koByStage = new Map<Stage, RawEvent[]>();

  const matches: MatchDoc[] = events.map((e) => {
    const comp = e.competitions[0];
    const stage = STAGE_MAP[e.season?.slug ?? ""] ?? "GROUP_STAGE";
    const home = comp.competitors.find((c) => c.homeAway === "home")!;
    const away = comp.competitors.find((c) => c.homeAway === "away")!;
    if (stage !== "GROUP_STAGE") {
      if (!koByStage.has(stage)) koByStage.set(stage, []);
      koByStage.get(stage)!.push(e);
    }
    const homeCode = resolve(home);
    const awayCode = resolve(away);
    const status = mapStatus(comp.status.type.state, comp.status.type.detail);
    const num = (v: string | number | undefined) =>
      v == null || v === "" ? null : Number(v);
    const venue = [comp.venue?.fullName, comp.venue?.address?.city]
      .filter(Boolean)
      .join(" · ");

    return {
      matchId: `ESPN-${e.id}`,
      stage,
      group:
        stage === "GROUP_STAGE" && homeCode
          ? groupOf.get(homeCode) || null
          : null,
      slot: `ESPN-${e.id}`,
      nextSlot: null,
      homePlaceholder: prettyPlaceholder(home.team.displayName),
      awayPlaceholder: prettyPlaceholder(away.team.displayName),
      homeCode,
      awayCode,
      homeScore: status === "SCHEDULED" ? null : num(home.score),
      awayScore: status === "SCHEDULED" ? null : num(away.score),
      homePens: num(home.shootoutScore),
      awayPens: num(away.shootoutScore),
      status,
      minute:
        status === "LIVE" || status === "PAUSED"
          ? parseMinute(comp.status.displayClock, comp.status.type.detail)
          : null,
      utcDate: e.date,
      venue,
    };
  });

  // === Reconstrucción del bracket real ===
  // El número de partido = orden por ID de evento (estable). OJO: el orden en que la
  // API *devuelve* los eventos cambia según estado (en vivo/terminado), pero el ID es
  // fijo y coincide con la numeración de los placeholders "Round of 32 N Winner".
  // El enlace ronda→ronda se deduce de cada partido de la ronda siguiente:
  //   - lado con placeholder "... N Winner"  -> alimentado por el partido #N de la ronda previa
  //   - lado con equipo real                 -> alimentado por el partido que ese equipo ganó
  const stageEvents = (s: Stage) =>
    [...(koByStage.get(s) || [])].sort((a, b) => Number(a.id) - Number(b.id));

  const slotOf = new Map<string, string>();
  for (const stage of KO_ORDER) {
    stageEvents(stage).forEach((e, i) =>
      slotOf.set(`ESPN-${e.id}`, `${KO_PREFIX[stage]}-${i + 1}`)
    );
  }

  const rawWinnerCode = (e: RawEvent): string | null => {
    const w = e.competitions[0].competitors.find((c) => c.winner === true);
    return w ? codeOf(w) : null;
  };
  // Partido de la ronda previa que alimenta este lado. Prioridad:
  //   1) EMPAREJAR POR EQUIPO: si el lado ya es un equipo real, es el ganador de
  //      ese partido -> 100% confiable, no depende de numeración.
  //   2) PLACEHOLDER "... N Winner": partido #N por orden de ID (solo para los aún
  //      no definidos; se auto-corrige a (1) cuando se juegan).
  const feederEvent = (
    c: RawCompetitor,
    prevList: RawEvent[]
  ): RawEvent | undefined => {
    const code = codeOf(c);
    if (code) {
      const byTeam = prevList.find((e) => rawWinnerCode(e) === code);
      if (byTeam) return byTeam;
    }
    const m = (c.team.displayName || "").match(/(\d+)\s*Winner$/i);
    if (m) return prevList[parseInt(m[1], 10) - 1];
    return undefined;
  };

  const nextSlotByMatchId = new Map<string, string>();
  const nextSideByMatchId = new Map<string, "home" | "away">();
  for (let r = 0; r < KO_ORDER.length - 1; r++) {
    const prevList = stageEvents(KO_ORDER[r]);
    const curList = stageEvents(KO_ORDER[r + 1]);
    for (const X of curList) {
      const xSlot = slotOf.get(`ESPN-${X.id}`);
      if (!xSlot) continue;
      for (const side of X.competitions[0].competitors) {
        const prev = feederEvent(side, prevList);
        if (prev) {
          nextSlotByMatchId.set(`ESPN-${prev.id}`, xSlot);
          nextSideByMatchId.set(`ESPN-${prev.id}`, side.homeAway);
        }
      }
    }
  }

  for (const m of matches) {
    const slot = slotOf.get(m.matchId);
    if (slot) m.slot = slot;
    const ns = nextSlotByMatchId.get(m.matchId);
    if (ns) {
      m.nextSlot = ns;
      m.nextSlotSide = nextSideByMatchId.get(m.matchId) ?? null;
    }
  }

  return { teams: [...teams.values()], matches };
}
