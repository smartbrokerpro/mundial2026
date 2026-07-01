# Mundial 2026 — Llaves en vivo 🏆

App **Next.js** que muestra el Mundial 2026 en formato de **llaves (bracket)**, con
resultados en vivo, tabla de grupos y el cuadro de eliminación que **se va formando**.

- **Dos vistas de llaves**: *Clásica* (SVG con conectores dinámicos) y *Radial (WebGL)* — anillos concéntricos con la final al centro, órbitas guía, energía animada, zoom al hacer click y goleadores.
- **Datos reales del Mundial 2026 EN VIVO, gratis y sin API key** vía la API pública de **ESPN** (`fifa.world`).
- **Sin base de datos**: los datos se consultan a ESPN y se cachean en memoria en el server (~1 request cada 30 s sin importar el tráfico). Deploy trivial.
- Marca los partidos que transmite **Chilevisión** con su logo.

## Puesta en marcha
```bash
npm install
npm run dev        # http://localhost:3088
```
No requiere base de datos ni configuración. `.env.local` es opcional:
```bash
DATA_SOURCE=espn          # default (gratis, sin key)
DATA_TTL_SECONDS=30       # cada cuánto refresca desde el proveedor
```

## Deploy (para compartir online)
No hay base de datos, así que basta cualquier host de Next.js:

- **Vercel** (recomendado): importa el repo → deploy. Sin env vars obligatorias.
  El caché de datos de Next hace que ESPN se consulte a lo sumo ~cada 30 s.
- **Railway / Render / Fly**: `npm run build` + `npm start`.

> Nada de secretos ni Mongo. La UI hace polling cada 15 s y el server sirve desde
> caché, refrescando el origen cada `DATA_TTL_SECONDS`.

## Fuentes alternativas (opcionales, requieren key)
`DATA_SOURCE` elige el proveedor:
- `espn` (default) — gratis, sin key, en vivo.
- `football-data.org` — free con retraso. + `FOOTBALL_DATA_API_KEY` ([registro](https://www.football-data.org/client/register)).
- `api-football` — su free tier **no** cubre 2026 (solo plan pago). + `API_FOOTBALL_KEY`.

## Arquitectura
```
ESPN (fifa.world)  ──►  provider (fetch + revalidate 30s)  ──►  caché en memoria
                                                                     │
                          computeStandings ──► /api/groups           │
                          buildBracket      ──► /api/bracket   ◄──────┤
                          matchFeed         ──► /api/matches   ◄──────┤
                          summary (goles)   ──► /api/scorers (on-demand)
                                                                     ▼
                                                          UI (SWR, polling 15s)
```
- `src/lib/providers/espn.ts` — trae los 104 partidos + standings y reconstruye el bracket real.
- `src/lib/queries.ts` — caché en memoria (sin DB), colapsa peticiones concurrentes, sirve stale ante error.
- `src/lib/bracket.ts` / `standings.ts` — arman cuadro y tablas; el bracket propaga ganadores y proyecta al líder en vivo.
- `src/lib/data/chilevision.ts` — partidos que transmite Chilevisión (editable).

## Endpoints
| Ruta | Descripción |
|------|-------------|
| `GET /api/matches` | En vivo + próximos + recientes |
| `GET /api/groups`  | Tabla de posiciones por grupo |
| `GET /api/bracket` | Cuadro de eliminación por rondas |
| `GET /api/scorers?event=<id>` | Goleadores de un partido |
| `POST /api/sync`   | Fuerza refresco del caché (opcional) |

> Los archivos de MongoDB (`scripts/seed.ts`, `src/lib/sync.ts`, `models.ts`) quedan
> como herramientas opcionales de CLI; **el app no las usa en runtime**.
