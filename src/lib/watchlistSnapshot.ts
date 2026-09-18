import { cache } from "react";
import type { Session } from "next-auth";
import { getValidSessionUserId } from "./auth";
import { prisma } from "./db";

export type WatchlistSnapshot = { movieIds: string[]; showIds: string[] };

export const EMPTY_WATCHLIST: WatchlistSnapshot = { movieIds: [], showIds: [] };

/**
 * The watchlist as of this request, read on the server so the client never has
 * to ask for it.
 *
 * WatchlistProvider used to fetch /api/watchlist on mount, and it could only
 * start once next-auth's own /api/auth/session round-trip had resolved --
 * because the fetch is gated on `status === "authenticated"`. Two serial round
 * trips stood between first paint and a working My List button, and
 * PosterWatchlistButton returns null for the whole of the first one, so the
 * buttons were not merely inert: they were absent from the DOM, and a click
 * where one was about to appear hit the poster behind it.
 *
 * Seeding both from the server collapses that to zero round trips -- the
 * buttons render in the SSR HTML with correct +/- state already.
 *
 * `cache` is React's per-request memo, the same wrapper getSession uses, so a
 * layout and a page asking on one request share a single pair of queries.
 */
export const getWatchlistSnapshot = cache(
  async (session: Session | null): Promise<WatchlistSnapshot> => {
    const userId = await getValidSessionUserId(session);
    if (!userId) return EMPTY_WATCHLIST;

    const [movies, shows] = await Promise.all([
      prisma.watchlistItem.findMany({
        where: { userId },
        orderBy: { addedAt: "desc" },
        select: { movieId: true },
      }),
      prisma.watchlistShowItem.findMany({
        where: { userId },
        orderBy: { addedAt: "desc" },
        select: { showId: true },
      }),
    ]);

    return {
      movieIds: movies.map((i) => i.movieId),
      showIds: shows.map((i) => i.showId),
    };
  }
);
