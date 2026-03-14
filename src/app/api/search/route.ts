import { NextResponse } from "next/server";
import { searchMovies, searchTVShows } from "@/lib/tmdb";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  if (!q || typeof q !== "string") {
    return NextResponse.json({ movies: [], shows: [] });
  }
  try {
    const [movies, shows] = await Promise.all([
      searchMovies(q, 10),
      searchTVShows(q, 10),
    ]);
    return NextResponse.json({ movies, shows });
  } catch (e) {
    console.error("Search error:", e);
    return NextResponse.json({ movies: [], shows: [] }, { status: 500 });
  }
}
