import { NextResponse } from "next/server";
import { getMatchFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feed = await getMatchFeed();
    return NextResponse.json(feed);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
