import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clearJellyfinWatchState } from "@/lib/jellyfin";
import { jellyfinUserIdFor } from "@/lib/jellyfinAccounts";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { historyPage, historyPaging, parseHistoryTarget, type HistoryRow } from "@/lib/watchHistoryRules";

export const dynamic = "force-dynamic";

/**
 * A person's own watch history: every movie and episode they have played,
 * newest first. Signed in, self only -- there is no user id to pass.
 */
export async function GET(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const { offset, limit } = historyPaging(params.get("offset"), params.get("limit"));
  // A row at zero is a title that was opened and never played.
  const where = { userId, progressSeconds: { gt: 0 } };
  const take = offset + limit + 1;
  const [movies, episodes] = await Promise.all([
    prisma.watchProgress.findMany({ where, orderBy: { updatedAt: "desc" }, take }),
    prisma.episodeProgress.findMany({ where, orderBy: { updatedAt: "desc" }, take }),
  ]);
  const { rows, hasMore } = historyPage(
    movies.map((m): HistoryRow => ({ kind: "movie", movieId: m.movieId, seconds: m.progressSeconds, at: m.updatedAt })),
    episodes.map(
      (e): HistoryRow => ({
        kind: "episode",
        showId: e.showId,
        season: e.seasonNumber,
        episode: e.episodeNumber,
        seconds: e.progressSeconds,
        at: e.updatedAt,
      })
    ),
    offset,
    limit
  );

  // Names come from TMDB (cached); a title it no longer knows still lists.
  const quiet = <T,>(lookup: Promise<T | null>) => lookup.catch(() => null);
  const movieIds = [...new Set(rows.flatMap((r) => (r.kind === "movie" ? [r.movieId] : [])))];
  const showIds = [...new Set(rows.flatMap((r) => (r.kind === "episode" ? [r.showId] : [])))];
  const [movieTitles, showTitles] = await Promise.all([
    Promise.all(movieIds.map(async (id) => [id, (await quiet(getMovieById(id)))?.title ?? null] as const)),
    Promise.all(showIds.map(async (id) => [id, (await quiet(getShowById(id)))?.name ?? null] as const)),
  ]);
  const movieTitle = new Map(movieTitles);
  const showTitle = new Map(showTitles);

  return NextResponse.json({
    items: rows.map((r) =>
      r.kind === "movie"
        ? { ...r, at: r.at.toISOString(), title: movieTitle.get(r.movieId) ?? "Unknown movie" }
        : { ...r, at: r.at.toISOString(), title: showTitle.get(r.showId) ?? "Unknown show" }
    ),
    hasMore,
  });
}

/**
 * Removes one entry, or all of them. Self only.
 *
 * An entry is the progress row itself, so removing it also forgets where the
 * person was: the title leaves Continue Watching and next plays from the start.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = parseHistoryTarget(await request.json().catch(() => null));
  if (!target) return NextResponse.json({ error: "Nothing to remove was named." }, { status: 400 });

  // Jellyfin first, and only then Streamy's rows: its record of the same
  // watch would otherwise be pulled back in as if it were new.
  const cleared = await clearJellyfinWatchState(await jellyfinUserIdFor(userId), target);
  if (!cleared) {
    return NextResponse.json({ error: "Could not reach the media server. Nothing was removed; try again." }, { status: 502 });
  }

  if (target.kind === "all") {
    await prisma.$transaction([
      prisma.watchProgress.deleteMany({ where: { userId } }),
      prisma.episodeProgress.deleteMany({ where: { userId } }),
    ]);
  } else if (target.kind === "movie") {
    await prisma.watchProgress.deleteMany({ where: { userId, movieId: target.movieId } });
  } else {
    await prisma.episodeProgress.deleteMany({
      where: { userId, showId: target.showId, seasonNumber: target.season, episodeNumber: target.episode },
    });
  }
  revalidatePath("/");
  return NextResponse.json({ removed: true });
}
