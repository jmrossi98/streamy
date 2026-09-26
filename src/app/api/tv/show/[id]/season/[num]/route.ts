import { NextResponse } from "next/server";
import { getSeason } from "@/lib/tmdb";

type Params = { params: Promise<{ id: string; num: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, num } = await params;
  const n = parseInt(num, 10);
  // n < 0, not n < 1. Season 0 is the specials season -- TMDB numbers it that
  // way -- and rejecting it here 400'd every client-side switch to the Extras
  // tab, which the page then rendered as "this show is unavailable". A reload
  // worked, because the server path fetches the season directly and never
  // comes through this route, which is what made it look like a data problem
  // rather than a routing one.
  if (Number.isNaN(n) || n < 0) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }
  try {
    const season = await getSeason(id, n);
    return NextResponse.json(season);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
