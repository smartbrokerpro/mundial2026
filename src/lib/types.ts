// Tipos compartidos del dominio del Mundial 2026.

export type Stage =
  | "GROUP_STAGE"
  | "LAST_32"
  | "LAST_16"
  | "QUARTER_FINALS"
  | "SEMI_FINALS"
  | "THIRD_PLACE"
  | "FINAL";

export type MatchStatus = "SCHEDULED" | "LIVE" | "PAUSED" | "FINISHED";

export interface TeamDoc {
  code: string; // FIFA 3-letter, ej "ARG"
  name: string;
  flag: string; // emoji bandera
  group: string | null; // "A".."L" o null
}

export interface MatchDoc {
  matchId: string; // id estable, ej "G-A-1" o "R32-1"
  stage: Stage;
  group: string | null;
  slot: string; // identificador del nodo en el bracket, ej "R32-1"
  nextSlot: string | null; // a qué nodo avanza el ganador
  nextSlotSide?: "home" | "away" | null; // qué lado del nodo siguiente alimenta
  // Placeholder para cuando aún no se conoce el equipo (ej "1A", "2B", "3rd", "W R32-1")
  homePlaceholder: string;
  awayPlaceholder: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  // En penales (si aplica)
  homePens: number | null;
  awayPens: number | null;
  status: MatchStatus;
  minute: number | null; // minuto de juego si LIVE
  utcDate: string; // ISO
  venue: string;
}

// ---- Resultados computados que consume el frontend ----

export interface StandingRow {
  code: string;
  name: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  rank: number; // 1..4 dentro del grupo
}

export interface GroupStanding {
  group: string;
  rows: StandingRow[];
}

export interface BracketTeam {
  code: string | null;
  name: string;
  flag: string;
  placeholder: string;
  score: number | null;
  pens: number | null;
  winner: boolean;
  lost?: boolean; // perdió un partido ya terminado
  provisional?: boolean; // proyectado desde un partido EN VIVO (resultado parcial)
}

export interface BracketMatch {
  matchId: string;
  slot: string;
  nextSlot: string | null;
  stage: Stage;
  status: MatchStatus;
  minute: number | null;
  utcDate: string;
  venue: string;
  home: BracketTeam;
  away: BracketTeam;
}

export interface BracketData {
  rounds: { stage: Stage; title: string; matches: BracketMatch[] }[];
}
