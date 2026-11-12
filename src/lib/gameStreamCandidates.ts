/**
 * The provider streams that might carry a game, best first: what the game
 * page's "More streams for this game" lists (api/live/game-streams) and what
 * pre-game prep checks (gamePrep.ts). Ranking is gameStreamRules.ts.
 */
import { listPromotedStreamIds, listStreams } from "./dispatcharr";
import { getAutomaticRenewals } from "./renewals";
import { providerAlert } from "./credentialRules";
import { gameStreamQueries, gameStreamScore, rankGameStreams } from "./gameStreamRules";
import { namesGameDate } from "./liveGuideGrid";
import { cached } from "./ttlCache";
import type { Fixture } from "./sportsSchedule";

export type GameStreamCandidate = {
  id: number;
  name: string;
  provider: string | null;
  logoUrl: string | null;
  /** 0 names both teams, 1 a team plus the league or carrying network; null names neither well. */
  score: number | null;
  /** Carries the game's own date: auto-add waits for these (pickAutoAdd). */
  dated: boolean;
};

export async function listGameStreamCandidates(fixture: Fixture): Promise<GameStreamCandidate[]> {
  const [pages, promoted, renewals] = await Promise.all([
    // Cached per game for a few minutes: the search took 23s on 2026-10-18,
    // and the page asks again right after adding a feed (and for every other
    // viewer of the same game). Only a complete answer is kept.
    cached(
      `game-streams:${fixture.id}`,
      3 * 60_000,
      () => Promise.all(gameStreamQueries(fixture).map((q) => listStreams({ search: q, pageSize: 100 }).catch(() => null))),
      { skipCacheIf: (pages) => pages.some((p) => p === null) }
    ),
    listPromotedStreamIds().catch(() => null),
    getAutomaticRenewals().catch(() => []),
  ]);
  const expiredProviders = new Set(
    renewals.filter((r) => r.source === "iptv" && providerAlert(r)?.tone === "danger").map((r) => r.name.toLowerCase())
  );
  const startMs = fixture.startUtc ? Date.parse(fixture.startUtc) : NaN;
  return rankGameStreams(pages.flatMap((p) => p?.items ?? []), fixture, {
    promoted: new Set(promoted?.keys() ?? []),
    expiredProviders,
  }).map((s) => ({
    id: s.id,
    name: s.name,
    provider: s.provider ?? null,
    logoUrl: s.logoUrl ?? null,
    score: gameStreamScore(s.name, fixture),
    dated: !!fixture.startUtc && namesGameDate(s.name, startMs),
  }));
}
