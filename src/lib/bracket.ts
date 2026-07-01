import type {
  BracketData,
  BracketMatch,
  BracketTeam,
  MatchDoc,
  Stage,
  TeamDoc,
} from "./types";

const ROUND_ORDER: { stage: Stage; title: string }[] = [
  { stage: "LAST_32", title: "Dieciseisavos" },
  { stage: "LAST_16", title: "Octavos" },
  { stage: "QUARTER_FINALS", title: "Cuartos" },
  { stage: "SEMI_FINALS", title: "Semifinales" },
  { stage: "FINAL", title: "Final" },
];

function teamView(
  code: string | null,
  placeholder: string,
  score: number | null,
  pens: number | null,
  isWinner: boolean,
  lost: boolean,
  provisional: boolean,
  teamMap: Map<string, TeamDoc>
): BracketTeam {
  const t = code ? teamMap.get(code) : undefined;
  return {
    code,
    name: t?.name ?? placeholder ?? "Por definir",
    flag: t?.flag ?? "⏳",
    placeholder,
    score,
    pens,
    winner: isWinner,
    lost,
    provisional,
  };
}

// Determina el ganador de un partido terminado (incluye penales).
function winnerCode(m: MatchDoc): string | null {
  if (m.status !== "FINISHED" || m.homeScore == null || m.awayScore == null)
    return null;
  if (m.homeScore > m.awayScore) return m.homeCode;
  if (m.awayScore > m.homeScore) return m.awayCode;
  if (m.homePens != null && m.awayPens != null) {
    if (m.homePens > m.awayPens) return m.homeCode;
    if (m.awayPens > m.homePens) return m.awayCode;
  }
  return null;
}

// Equipo que va ganando parcialmente en un partido EN VIVO (null si va empatado).
function liveLeader(m: MatchDoc): string | null {
  if (m.status !== "LIVE" && m.status !== "PAUSED") return null;
  if (m.homeScore == null || m.awayScore == null) return null;
  if (m.homeScore > m.awayScore) return m.homeCode;
  if (m.awayScore > m.homeScore) return m.awayCode;
  return null;
}

// Construye el bracket por rondas a partir de los partidos de eliminación.
// "Se va formando": al terminar un partido propaga el ganador al slot siguiente; y
// si un partido está EN VIVO, proyecta al líder parcial (marcado como provisional).
export function buildBracket(
  teams: TeamDoc[],
  matches: MatchDoc[]
): BracketData {
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const ko = matches.filter((m) => m.stage !== "GROUP_STAGE");
  const bySlot = new Map(ko.map((m) => [m.slot, { ...m }]));
  // Marca qué lados de cada slot se llenaron con una proyección en vivo.
  const prov = new Map<string, { home: boolean; away: boolean }>();
  const markProv = (slot: string, side: "home" | "away") => {
    const p = prov.get(slot) ?? { home: false, away: false };
    p[side] = true;
    prov.set(slot, p);
  };

  // Coloca un equipo en el slot siguiente: en el lado indicado (nextSlotSide) si se
  // conoce, o en el primer lado libre como respaldo.
  const place = (
    nextSlot: string,
    code: string,
    provisional: boolean,
    side: "home" | "away" | null | undefined
  ) => {
    const next = bySlot.get(nextSlot);
    if (!next) return;
    const order: ("home" | "away")[] =
      side === "home" ? ["home"] : side === "away" ? ["away"] : ["home", "away"];
    for (const s of order) {
      if (s === "home" && next.homeCode == null) {
        next.homeCode = code;
        if (provisional) markProv(next.slot, "home");
        return;
      }
      if (s === "away" && next.awayCode == null) {
        next.awayCode = code;
        if (provisional) markProv(next.slot, "away");
        return;
      }
    }
  };

  // Paso 1 — cascada de ganadores definitivos (orden de rondas garantiza propagación).
  for (const round of ROUND_ORDER) {
    for (const m of ko.filter((x) => x.stage === round.stage)) {
      const cur = bySlot.get(m.slot)!;
      const w = winnerCode(cur);
      if (w && cur.nextSlot) place(cur.nextSlot, w, false, cur.nextSlotSide);
    }
  }
  // Paso 2 — proyección de partidos EN VIVO al lado correspondiente (provisional).
  for (const m of ko) {
    const cur = bySlot.get(m.slot)!;
    const leader = liveLeader(cur);
    if (leader && cur.nextSlot) place(cur.nextSlot, leader, true, cur.nextSlotSide);
  }

  // Orden de display: recorrido in-order del árbol (desde la final) para que cada
  // partido quede centrado entre sus dos alimentadores -> bracket visualmente limpio.
  const childrenOf = new Map<string, { home?: string; away?: string }>();
  let haveSides = true;
  for (const m of ko) {
    if (!m.nextSlot) continue;
    if (m.nextSlotSide !== "home" && m.nextSlotSide !== "away") haveSides = false;
    const c = childrenOf.get(m.nextSlot) ?? {};
    if (m.nextSlotSide === "home") c.home = m.slot;
    else if (m.nextSlotSide === "away") c.away = m.slot;
    childrenOf.set(m.nextSlot, c);
  }
  const orderOf = new Map<string, number>();
  if (haveSides) {
    let counter = 0;
    const finalSlot = ko.find((m) => m.stage === "FINAL")?.slot;
    const dfs = (slot: string | undefined) => {
      if (!slot) return;
      const ch = childrenOf.get(slot);
      dfs(ch?.home);
      orderOf.set(slot, counter++);
      dfs(ch?.away);
    };
    dfs(finalSlot);
  }
  const sortKey = (slot: string) =>
    orderOf.has(slot)
      ? orderOf.get(slot)!
      : parseInt(slot.split("-")[1] ?? "0", 10);

  const rounds = ROUND_ORDER.map((r) => {
    const ms = ko
      .filter((m) => m.stage === r.stage)
      .map((m) => bySlot.get(m.slot)!)
      .sort((a, b) => sortKey(a.slot) - sortKey(b.slot));

    const matchesView: BracketMatch[] = ms.map((m) => {
      const w = winnerCode(m);
      const p = prov.get(m.slot) ?? { home: false, away: false };
      return {
        matchId: m.matchId,
        slot: m.slot,
        nextSlot: m.nextSlot,
        stage: m.stage,
        status: m.status,
        minute: m.minute,
        utcDate: m.utcDate,
        venue: m.venue,
        home: teamView(
          m.homeCode,
          m.homePlaceholder,
          m.homeScore,
          m.homePens,
          w != null && w === m.homeCode,
          w != null && m.homeCode != null && w !== m.homeCode,
          p.home,
          teamMap
        ),
        away: teamView(
          m.awayCode,
          m.awayPlaceholder,
          m.awayScore,
          m.awayPens,
          w != null && w === m.awayCode,
          w != null && m.awayCode != null && w !== m.awayCode,
          p.away,
          teamMap
        ),
      };
    });
    return { stage: r.stage, title: r.title, matches: matchesView };
  });

  return { rounds };
}
