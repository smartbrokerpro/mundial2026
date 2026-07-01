// Partidos del Mundial 2026 que transmite Chilevisión (Chile) — señal abierta.
// Fuente: chilevision.cl / redgol (jul 2026). Lista FIJA y editable: para agregar
// partidos (ej. cuando confirmen octavos+) añade el enfrentamiento "COD1-COD2".
// Los códigos son los de la API (abreviatura FIFA): FRA, SWE, MEX, ECU, etc.
export const CHV_MATCHUPS: string[] = [
  // --- Dieciseisavos de final (round of 32) ---
  "FRA-SWE",
  "MEX-ECU",
  "BEL-SEN",
  "ESP-AUT",
  "POR-CRO",
  "ARG-CPV",
  "COL-GHA",

  // --- Fase de grupos (ya jugados) ---
  "MEX-RSA", "CAN-BIH", "USA-PAR", "QAT-SUI", "BRA-MAR", "NED-JPN",
  "CIV-ECU", "BEL-EGY", "KSA-URU", "FRA-SEN", "ARG-ALG", "ENG-CRO",
  "UZB-COL", "SUI-BIH", "CAN-QAT", "USA-AUS", "SCO-MAR", "TUN-JPN",
  "GER-CIV", "ESP-KSA", "BEL-IRN", "ARG-AUT", "NOR-SEN", "POR-UZB",
  "ENG-GHA", "PAN-CRO", "SCO-BRA", "MEX-CZE", "ECU-GER", "TUN-NED",
  "PAR-AUS", "NOR-FRA", "URU-ESP", "COL-POR",

  // --- Octavos, cuartos, semis y final: agregar aquí cuando CHV los confirme ---
];

// Etapas que Chilevisión transmite completas (cuando se confirmen). Ej: "FINAL".
export const CHV_STAGES: string[] = [];

const key = (a: string, b: string) => [a, b].sort().join("-");
const SET = new Set(CHV_MATCHUPS.map((m) => key(...(m.split("-") as [string, string]))));

// ¿Este partido lo transmite Chilevisión?
export function airsOnCHV(
  homeCode: string | null | undefined,
  awayCode: string | null | undefined,
  stage?: string
): boolean {
  if (stage && CHV_STAGES.includes(stage)) return true;
  if (!homeCode || !awayCode) return false;
  return SET.has(key(homeCode, awayCode));
}
