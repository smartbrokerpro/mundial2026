import { NextResponse } from "next/server";
import { getBracket } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bracket = await getBracket();
    return NextResponse.json(bracket);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
