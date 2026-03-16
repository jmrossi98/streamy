import { NextResponse } from "next/server";

/** GET /api/movies/[id] - returns movie details. In dev uses mock unless TMDB_USE_REAL_API=true. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const hasKey = !!process.env.TMDB_API_KEY;
  const explicitReal = ["true", "1", "yes"].includes(
    process.env.TMDB_USE_REAL_API?.toLowerCase().trim() ?? ""
  );
  const useRealApi = process.env.NODE_ENV !== "development" || hasKey || explicitReal;
  if (!useRealApi) {
    const { mockGetMovieById } = await import("@/lib/tmdb-mock");
    const movie = await mockGetMovieById(id);
    return NextResponse.json(movie);
  }

  const { getMovieById } = await import("@/lib/tmdb");
  try {
    const movie = await getMovieById(id);
    if (!movie) return NextResponse.json(null, { status: 404 });
    return NextResponse.json(movie);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
