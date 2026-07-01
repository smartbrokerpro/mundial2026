import { NextResponse } from "next/server";
import { getStandings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const groups = await getStandings();
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message }, { status: 500 }
    );
  }
}
