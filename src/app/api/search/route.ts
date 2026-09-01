import { NextResponse } from "next/server";
import { searchMovies, searchTVShows, mergeSearchResults } from "@/lib/tmdb";
export type { SearchResultItem } from "@/lib/tmdb";

const SEARCH_LIMIT = 10;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  if (!q || typeof q !== "string") {
    return NextResponse.json({ results: [], hasMore: false });
  }
  try {
    const [movies, shows] = await Promise.all([
      searchMovies(q, SEARCH_LIMIT, page),
      searchTVShows(q, SEARCH_LIMIT, page),
    ]);
    const results = mergeSearchResults(movies, shows);
    const hasMore = movies.length >= SEARCH_LIMIT || shows.length >= SEARCH_LIMIT;
    return NextResponse.json({ results, page, hasMore });
  } catch (e) {
    console.error("Search error:", e);
    return NextResponse.json({ results: [], hasMore: false }, { status: 500 });
  }
}
