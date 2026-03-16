import { NextResponse } from "next/server";

/** GET /api/tmdb-mode - returns whether the app is using real TMDB API or mock data (for debugging). */
export async function GET() {
  const isDev = process.env.NODE_ENV === "development";
  const explicitReal = ["true", "1", "yes"].includes(
    process.env.TMDB_USE_REAL_API?.toLowerCase().trim() ?? ""
  );
  const useRealApi = !isDev || !!process.env.TMDB_API_KEY || explicitReal;
  const tmdbApiKeySet = !!process.env.TMDB_API_KEY;
  return NextResponse.json({
    dataSource: useRealApi ? "real" : "mock",
    development: isDev,
    tmdbApiKeySet,
    tmdbUseRealApiEnv: process.env.TMDB_USE_REAL_API ? "set" : "not set",
  });
}
