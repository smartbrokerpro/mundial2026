import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";

interface Scorer {
  player: string;
  minute: string;
  own: boolean;
}

// Goleadores de un partido (endpoint summary de ESPN), agrupados por local/visita.
export async function GET(req: Request) {
  const event = new URL(req.url).searchParams.get("event");
  const empty = { home: [] as Scorer[], away: [] as Scorer[] };
  if (!event) return NextResponse.json(empty);

  try {
    const res = await fetch(`${SUMMARY}?event=${encodeURIComponent(event)}`, {
      next: { revalidate: 20 },
    });
    if (!res.ok) return NextResponse.json(empty);
    const d = await res.json();

    const comp = d.header?.competitions?.[0];
    const sideByTeam = new Map<string, "home" | "away">();
    for (const c of comp?.competitors ?? [])
      sideByTeam.set(String(c.team?.id), c.homeAway);

    const home: Scorer[] = [];
    const away: Scorer[] = [];
    for (const e of d.keyEvents ?? []) {
      if (!e.scoringPlay || e.shootout) continue; // solo goles de juego (no penales de tanda)
      const player =
        e.participants?.[0]?.athlete?.displayName ||
        (e.shortText || "").replace(/\s*Goal.*$/i, "") ||
        "Gol";
      const minute = e.clock?.displayValue || "";
      const own = /own goal/i.test(e.type?.text || "");
      const side = sideByTeam.get(String(e.team?.id));
      const entry: Scorer = { player, minute, own };
      if (side === "home") home.push(entry);
      else if (side === "away") away.push(entry);
    }
    return NextResponse.json({ home, away });
  } catch {
    return NextResponse.json(empty);
  }
}
