/**
 * Seed de un Mundial 2026 "en curso" para MongoDB local.
 * - 48 equipos, 12 grupos, fase de grupos COMPLETA (72 partidos).
 * - Dieciseisavos (R32) jugados -> clasifican los ganadores.
 * - Octavos (R16): algunos terminados, 2 EN VIVO, resto programados.
 * - Cuartos/Semis/Final: por definir (el bracket los va completando).
 *
 * Ejecutar:  npm run seed
 */
import { dbConnect } from "../src/lib/mongodb";
import { Team, Match } from "../src/lib/models";
import { computeStandings } from "../src/lib/standings";
import { TEAMS_2026 } from "../src/lib/data/teams2026";
import type { MatchDoc, Stage } from "../src/lib/types";

// ---------- utilidades deterministas ----------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}

const STRENGTH: Record<string, number> = {
  ARG: 92, FRA: 91, BRA: 90, ESP: 89, ENG: 88,
  GER: 85, POR: 85, NED: 84, BEL: 83, ITA: 82,
  CRO: 80, URU: 80, COL: 79, MAR: 79, USA: 78, MEX: 78, JPN: 78, SUI: 77, DEN: 77, SEN: 77,
  KOR: 73, ECU: 72, AUS: 72, NGA: 72, SRB: 72, NOR: 72, AUT: 71, UKR: 71, IRN: 71, EGY: 70, CMR: 70, GHA: 70, CIV: 70, PER: 70, PAR: 69, QAT: 68,
  RSA: 65, SCO: 66, PAN: 64, UZB: 64, NZL: 63, JOR: 63, KSA: 63, TUN: 65, CRC: 64, HON: 62, ALG: 66,
};
const str = (c: string) => STRENGTH[c] ?? 70;

// Genera un marcador plausible para att vs def. `ko` => evita empate (penales).
function score(home: string, away: string, id: string, ko: boolean) {
  const diff = (str(home) - str(away)) / 12;
  const hr = hash(id + ":h");
  const ar = hash(id + ":a");
  let hg = Math.max(0, Math.min(6, Math.round(1.3 + diff * 0.5 + (hr - 0.5) * 3)));
  let ag = Math.max(0, Math.min(6, Math.round(1.3 - diff * 0.5 + (ar - 0.5) * 3)));
  let hp: number | null = null;
  let ap: number | null = null;
  if (ko && hg === ag) {
    // Penales: gana el más fuerte (con algo de ruido).
    const favHome = str(home) + (hash(id + ":p") - 0.45) * 20 >= str(away);
    if (favHome) {
      hp = 4 + Math.round(hash(id + ":ph"));
      ap = hp - 1;
    } else {
      ap = 4 + Math.round(hash(id + ":pa"));
      hp = ap - 1;
    }
  }
  return { hg, ag, hp, ap };
}

const VENUES = [
  "Estadio Azteca · Ciudad de México",
  "MetLife · Nueva York",
  "SoFi · Los Ángeles",
  "AT&T · Dallas",
  "Mercedes-Benz · Atlanta",
  "NRG · Houston",
  "Lumen Field · Seattle",
  "Levi's · San Francisco",
  "Hard Rock · Miami",
  "Arrowhead · Kansas City",
  "Lincoln Financial · Filadelfia",
  "Gillette · Boston",
  "BC Place · Vancouver",
  "BMO Field · Toronto",
  "Estadio Akron · Guadalajara",
  "Estadio BBVA · Monterrey",
];
const venue = (i: number) => VENUES[i % VENUES.length];

// round-robin de 4 equipos: 6 partidos
const RR_PAIRS: [number, number][] = [
  [0, 1], [2, 3],
  [0, 2], [1, 3],
  [0, 3], [1, 2],
];

async function main() {
  await dbConnect();
  await Promise.all([Team.deleteMany({}), Match.deleteMany({})]);
  await Team.insertMany(TEAMS_2026);

  const matches: MatchDoc[] = [];
  const groups = [...new Set(TEAMS_2026.map((t) => t.group))].filter(
    Boolean
  ) as string[];

  // ---------- Fase de grupos (todos FINISHED) ----------
  let gIdx = 0;
  for (const g of groups.sort()) {
    const teams = TEAMS_2026.filter((t) => t.group === g);
    RR_PAIRS.forEach(([a, b], k) => {
      const home = teams[a].code;
      const away = teams[b].code;
      const id = `G-${g}-${k + 1}`;
      const s = score(home, away, id, false);
      const day = 13 + Math.floor(k / 2) * 6; // jornadas: 13, 19, 25 jun
      matches.push({
        matchId: id,
        stage: "GROUP_STAGE",
        group: g,
        slot: id,
        nextSlot: null,
        homePlaceholder: home,
        awayPlaceholder: away,
        homeCode: home,
        awayCode: away,
        homeScore: s.hg,
        awayScore: s.ag,
        homePens: null,
        awayPens: null,
        status: "FINISHED",
        minute: null,
        utcDate: `2026-06-${String(day).padStart(2, "0")}T18:00:00Z`,
        venue: venue(gIdx * 2 + k),
      });
    });
    gIdx++;
  }

  // ---------- Clasificados: 1º y 2º de cada grupo + 8 mejores terceros ----------
  const standings = computeStandings(TEAMS_2026, matches);
  const firsts: string[] = [];
  const seconds: string[] = [];
  const thirds: { code: string; points: number; gd: number; gf: number }[] = [];
  for (const gs of standings) {
    firsts.push(gs.rows[0].code);
    seconds.push(gs.rows[1].code);
    const t = gs.rows[2];
    thirds.push({ code: t.code, points: t.points, gd: t.gd, gf: t.gf });
  }
  thirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  const bestThirds = thirds.slice(0, 8).map((t) => t.code);

  // 32 clasificados. Emparejado evitando duplicar grupo en R32.
  const groupOf = new Map(TEAMS_2026.map((t) => [t.code, t.group!]));
  const pool = [...firsts, ...seconds, ...bestThirds]; // 12+12+8 = 32
  const pairs: [string, string][] = [];
  for (let i = 0; i < 16; i++) {
    let a = pool[i];
    let b = pool[31 - i];
    if (groupOf.get(a) === groupOf.get(b)) {
      // swap b con el siguiente disponible para evitar revancha de grupo
      const j = (31 - i - 1 + 32) % 32;
      [pool[31 - i], pool[j]] = [pool[j], pool[31 - i]];
      b = pool[31 - i];
    }
    pairs.push([a, b]);
  }

  // ---------- Dieciseisavos (R32) — en curso a hoy 30-jun ----------
  // 0-11 terminados (28-29 jun), 12-13 EN VIVO (30 jun), 14-15 por jugar (1 jul).
  const r32Winners: (string | null)[] = [];
  pairs.forEach(([home, away], i) => {
    const slot = `R32-${i + 1}`;
    const id = slot;
    const s = score(home, away, id, true);

    let status: MatchStatusLocal = "SCHEDULED";
    if (i < 12) status = "FINISHED";
    else if (i < 14) status = "LIVE";

    let homeScore: number | null = null;
    let awayScore: number | null = null;
    let homePens: number | null = null;
    let awayPens: number | null = null;
    let minute: number | null = null;
    let winner: string | null = null;
    let utcDate = "2026-07-01T19:00:00Z"; // por jugar

    if (status === "FINISHED") {
      homeScore = s.hg;
      awayScore = s.ag;
      homePens = s.hp;
      awayPens = s.ap;
      winner =
        s.hg > s.ag || (s.hg === s.ag && (s.hp ?? 0) > (s.ap ?? 0))
          ? home
          : away;
      utcDate = `2026-06-${28 + (i % 2)}T19:00:00Z`;
    } else if (status === "LIVE") {
      homeScore = Math.min(s.hg, Math.round(s.hg * 0.6));
      awayScore = Math.min(s.ag, Math.round(s.ag * 0.6));
      minute = 55 + (i - 12) * 8;
      utcDate = "2026-06-30T20:00:00Z";
    }
    r32Winners.push(winner);

    matches.push({
      matchId: id,
      stage: "LAST_32",
      group: null,
      slot,
      nextSlot: `R16-${Math.ceil((i + 1) / 2)}`,
      homePlaceholder: seedLabel(home, firsts, seconds),
      awayPlaceholder: seedLabel(away, firsts, seconds),
      homeCode: home,
      awayCode: away,
      homeScore,
      awayScore,
      homePens,
      awayPens,
      status,
      minute,
      utcDate,
      venue: venue(i),
    });
  });

  // ---------- Octavos (R16) — por jugar (4-7 jul) ----------
  // Cada slot se llena con el ganador del dieciseisavos correspondiente (null = por definir).
  for (let i = 0; i < 8; i++) {
    const home = r32Winners[i * 2] ?? null;
    const away = r32Winners[i * 2 + 1] ?? null;
    const slot = `R16-${i + 1}`;
    matches.push({
      matchId: slot,
      stage: "LAST_16",
      group: null,
      slot,
      nextSlot: `QF-${Math.ceil((i + 1) / 2)}`,
      homePlaceholder: `Ganador R32-${i * 2 + 1}`,
      awayPlaceholder: `Ganador R32-${i * 2 + 2}`,
      homeCode: home,
      awayCode: away,
      homeScore: null,
      awayScore: null,
      homePens: null,
      awayPens: null,
      status: "SCHEDULED",
      minute: null,
      utcDate: `2026-07-0${4 + Math.floor(i / 2)}T19:00:00Z`,
      venue: venue(i + 4),
    });
  }

  // ---------- Cuartos / Semis / Final (por definir, se llenan al avanzar) ----------
  const later: { stage: Stage; prefix: string; count: number; next: string }[] =
    [
      { stage: "QUARTER_FINALS", prefix: "QF", count: 4, next: "SF" },
      { stage: "SEMI_FINALS", prefix: "SF", count: 2, next: "FINAL" },
      { stage: "FINAL", prefix: "FINAL", count: 1, next: "" },
    ];
  let dayBase = 9;
  for (const round of later) {
    for (let i = 0; i < round.count; i++) {
      const slot = `${round.prefix}-${i + 1}`;
      const prevPrefix =
        round.prefix === "QF" ? "R16" : round.prefix === "SF" ? "QF" : "SF";
      matches.push({
        matchId: slot,
        stage: round.stage,
        group: null,
        slot,
        nextSlot: round.next ? `${round.next}-${Math.ceil((i + 1) / 2)}` : null,
        homePlaceholder: `Ganador ${prevPrefix}-${i * 2 + 1}`,
        awayPlaceholder: `Ganador ${prevPrefix}-${i * 2 + 2}`,
        homeCode: null,
        awayCode: null,
        homeScore: null,
        awayScore: null,
        homePens: null,
        awayPens: null,
        status: "SCHEDULED",
        minute: null,
        utcDate: `2026-07-${String(dayBase + i).padStart(2, "0")}T19:00:00Z`,
        venue: venue(i + 8),
      });
    }
    dayBase += 4;
  }

  await Match.insertMany(matches);
  console.log(
    `✅ Seed listo: ${TEAMS_2026.length} equipos, ${matches.length} partidos.`
  );
  process.exit(0);
}

type MatchStatusLocal = "SCHEDULED" | "LIVE" | "FINISHED";

// Etiqueta de procedencia (1A, 2B, 3X) para los placeholders de R32.
function seedLabel(code: string, firsts: string[], seconds: string[]): string {
  const team = TEAMS_2026.find((t) => t.code === code)!;
  if (firsts.includes(code)) return `1${team.group}`;
  if (seconds.includes(code)) return `2${team.group}`;
  return `3${team.group}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
