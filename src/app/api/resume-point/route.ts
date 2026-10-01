import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findJellyfinEpisodeItemId, findJellyfinMovieItemId, getJellyfinUserData } from "@/lib/jellyfin";
import { jellyfinUserIdFor } from "@/lib/jellyfinAccounts";
import { resumeSeconds } from "@/lib/progressSyncRules";

export const dynamic = "force-dynamic";

/**
 * Where playback should start, decided at the moment the player opens.
 *
 * The page that renders a player computes the same thing, but that page can be
 * minutes old -- prefetched, or a show page left open while something was
 * watched on the Roku -- so the player asks again here and seeks if the
 * answer moved. ?movieId=, or ?showId=&season=&episode=.
 */
export async function GET(request: Request) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ seconds: null });
  const q = new URL(request.url).searchParams;
  const movieId = q.get("movieId");
  const showId = q.get("showId");
  const season = Number(q.get("season"));
  const episode = Number(q.get("episode"));

  let row: { progressSeconds: number; updatedAt: Date } | null = null;
  let itemIdPromise: Promise<string | null>;
  if (movieId) {
    row = await prisma.watchProgress.findUnique({ where: { userId_movieId: { userId, movieId } } });
    itemIdPromise = findJellyfinMovieItemId(movieId);
  } else if (showId && Number.isFinite(season) && Number.isFinite(episode)) {
    row = await prisma.episodeProgress.findUnique({
      where: { userId_showId_seasonNumber_episodeNumber: { userId, showId, seasonNumber: season, episodeNumber: episode } },
    });
    itemIdPromise = findJellyfinEpisodeItemId(showId, season, episode);
  } else {
    return NextResponse.json({ error: "movieId, or showId+season+episode" }, { status: 400 });
  }
  const [itemId, jellyfinUserId] = await Promise.all([itemIdPromise, jellyfinUserIdFor(userId)]);
  const jellyfin = itemId ? await getJellyfinUserData(itemId, jellyfinUserId) : null;
  const seconds = resumeSeconds(row ? { seconds: row.progressSeconds, updatedAt: row.updatedAt } : null, jellyfin);
  return NextResponse.json({ seconds }, { headers: { "Cache-Control": "no-store" } });
}
