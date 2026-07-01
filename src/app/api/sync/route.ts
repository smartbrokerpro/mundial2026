import { NextResponse } from "next/server";
import { load } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Fuerza un refresco del caché en memoria desde el proveedor (ESPN por defecto).
// Sin base de datos: los datos se leen y cachean en el propio server.
async function refresh() {
  const { teams, matches } = await load(true);
  return NextResponse.json({
    ok: true,
    source: process.env.DATA_SOURCE?.trim() || "espn",
    teams: teams.length,
    matches: matches.length,
  });
}

export async function POST() {
  try {
    return await refresh();
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 500 });
  }
}

export const GET = POST;
