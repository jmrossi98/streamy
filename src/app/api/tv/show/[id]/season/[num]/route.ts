import { NextResponse } from "next/server";
import { getSeason } from "@/lib/tmdb";

type Params = { params: Promise<{ id: string; num: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id, num } = await params;
  const n = parseInt(num, 10);
  if (Number.isNaN(n) || n < 1) return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  try {
    const season = await getSeason(id, n);
    return NextResponse.json(season);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
