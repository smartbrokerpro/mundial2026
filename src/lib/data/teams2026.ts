import type { TeamDoc } from "../types";

// 48 selecciones repartidas en 12 grupos (A–L) — set plausible para el Mundial 2026.
// (Anfitriones: México, Canadá, USA). Banderas en emoji para render nítido sin assets.
export const TEAMS_2026: TeamDoc[] = [
  { code: "MEX", name: "México", flag: "🇲🇽", group: "A" },
  { code: "KOR", name: "Corea del Sur", flag: "🇰🇷", group: "A" },
  { code: "RSA", name: "Sudáfrica", flag: "🇿🇦", group: "A" },
  { code: "NOR", name: "Noruega", flag: "🇳🇴", group: "A" },

  { code: "CAN", name: "Canadá", flag: "🇨🇦", group: "B" },
  { code: "BEL", name: "Bélgica", flag: "🇧🇪", group: "B" },
  { code: "EGY", name: "Egipto", flag: "🇪🇬", group: "B" },
  { code: "PAR", name: "Paraguay", flag: "🇵🇾", group: "B" },

  { code: "USA", name: "Estados Unidos", flag: "🇺🇸", group: "C" },
  { code: "JPN", name: "Japón", flag: "🇯🇵", group: "C" },
  { code: "SCO", name: "Escocia", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", group: "C" },
  { code: "CIV", name: "Costa de Marfil", flag: "🇨🇮", group: "C" },

  { code: "ARG", name: "Argentina", flag: "🇦🇷", group: "D" },
  { code: "AUS", name: "Australia", flag: "🇦🇺", group: "D" },
  { code: "PAN", name: "Panamá", flag: "🇵🇦", group: "D" },
  { code: "UZB", name: "Uzbekistán", flag: "🇺🇿", group: "D" },

  { code: "FRA", name: "Francia", flag: "🇫🇷", group: "E" },
  { code: "SEN", name: "Senegal", flag: "🇸🇳", group: "E" },
  { code: "NZL", name: "Nueva Zelanda", flag: "🇳🇿", group: "E" },
  { code: "JOR", name: "Jordania", flag: "🇯🇴", group: "E" },

  { code: "BRA", name: "Brasil", flag: "🇧🇷", group: "F" },
  { code: "CRO", name: "Croacia", flag: "🇭🇷", group: "F" },
  { code: "CMR", name: "Camerún", flag: "🇨🇲", group: "F" },
  { code: "QAT", name: "Catar", flag: "🇶🇦", group: "F" },

  { code: "ENG", name: "Inglaterra", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", group: "G" },
  { code: "SUI", name: "Suiza", flag: "🇨🇭", group: "G" },
  { code: "ECU", name: "Ecuador", flag: "🇪🇨", group: "G" },
  { code: "KSA", name: "Arabia Saudita", flag: "🇸🇦", group: "G" },

  { code: "ESP", name: "España", flag: "🇪🇸", group: "H" },
  { code: "URU", name: "Uruguay", flag: "🇺🇾", group: "H" },
  { code: "GHA", name: "Ghana", flag: "🇬🇭", group: "H" },
  { code: "UKR", name: "Ucrania", flag: "🇺🇦", group: "H" },

  { code: "POR", name: "Portugal", flag: "🇵🇹", group: "I" },
  { code: "COL", name: "Colombia", flag: "🇨🇴", group: "I" },
  { code: "IRN", name: "Irán", flag: "🇮🇷", group: "I" },
  { code: "TUN", name: "Túnez", flag: "🇹🇳", group: "I" },

  { code: "GER", name: "Alemania", flag: "🇩🇪", group: "J" },
  { code: "MAR", name: "Marruecos", flag: "🇲🇦", group: "J" },
  { code: "SRB", name: "Serbia", flag: "🇷🇸", group: "J" },
  { code: "CRC", name: "Costa Rica", flag: "🇨🇷", group: "J" },

  { code: "NED", name: "Países Bajos", flag: "🇳🇱", group: "K" },
  { code: "NGA", name: "Nigeria", flag: "🇳🇬", group: "K" },
  { code: "AUT", name: "Austria", flag: "🇦🇹", group: "K" },
  { code: "HON", name: "Honduras", flag: "🇭🇳", group: "K" },

  { code: "ITA", name: "Italia", flag: "🇮🇹", group: "L" },
  { code: "DEN", name: "Dinamarca", flag: "🇩🇰", group: "L" },
  { code: "ALG", name: "Argelia", flag: "🇩🇿", group: "L" },
  { code: "PER", name: "Perú", flag: "🇵🇪", group: "L" },
];

export const TEAM_BY_CODE = new Map(TEAMS_2026.map((t) => [t.code, t]));
