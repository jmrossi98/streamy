import { NextResponse } from "next/server";
import { getMovieById } from "@/lib/tmdb";

/** GET /api/movies/runtimes?ids=1,2,3 → { "1": 120, "2": 95 }. Used by client to build progressMap without blocking server render. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  if (!idsParam) return NextResponse.json({}, { status: 200 });
  const ids = Array.from(new Set(idsParam.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))));
  if (ids.length === 0) return NextResponse.json({}, { status: 200 });
  if (ids.length > 50) return NextResponse.json({ error: "Too many ids" }, { status: 400 });

  const results = await Promise.all(ids.map((id) => getMovieById(String(id))));
  const runtimes: Record<string, number | null> = {};
  ids.forEach((id, i) => {
    const detail = results[i];
    runtimes[String(id)] = detail?.runtime ?? null;
  });
  return NextResponse.json(runtimes);
}
