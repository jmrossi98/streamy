import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWatchlistPage } from "@/lib/watchlist";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(24, Math.max(1, parseInt(searchParams.get("limit") ?? "12", 10)));
  try {
    const result = await getWatchlistPage(session.user.id, page, limit);
    return NextResponse.json(result);
  } catch (e) {
    console.error("Watchlist items error:", e);
    return NextResponse.json(
      { movies: [], shows: [], progressMap: {}, hasMoreMovies: false, hasMoreShows: false },
      { status: 500 }
    );
  }
}
