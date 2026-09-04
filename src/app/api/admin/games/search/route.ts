import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isGamarrConfigured, searchGames, type GameSearchResult } from "@/lib/gamarr";

/**
 * Game/ROM search, proxied through Streamy so gamarr itself never needs to be
 * exposed to the browser (it's a homelab-only service with no auth of its own).
 *
 * A search fans out across every configured indexer and measured ~30s live --
 * confirmed live again while investigating "speed up search": even a query
 * guaranteed to match nothing still took 17.6s, so the cost is pure per-query
 * fan-out latency (Prowlarr alone aggregates 7+ indexers), not proportional to
 * results found. That's inherent to gamarr/Prowlarr's own design; nothing
 * Streamy's wrapper does adds to it, and nothing here can shorten a single
 * search without either querying fewer indexers or cutting a slower one off
 * sooner -- both real coverage/speed tradeoffs for mediabox's own gamarr
 * config to make deliberately, not something to change silently from here.
 *
 * What Streamy's own layer *can* honestly do: never make the same slow
 * search happen twice. Same (query, platform) within CACHE_TTL_MS reuses the
 * prior result instantly, and two requests for the same search that land
 * while the first is still in flight (a double-click, a re-render) share
 * that one upstream call instead of firing a second simultaneous ~30s
 * search. Process-lifetime only (a plain Map, not a DB) -- restarting on
 * deploy losing the cache is a fine tradeoff for not needing a table just
 * for this.
 */
export const dynamic = "force-dynamic";
// The upstream search alone can take ~30s (90s ceiling in gamarr.ts). Node's
// default route timeout would cut that off well before gamarr answers.
export const maxDuration = 120;

const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { promise: Promise<GameSearchResult[]>; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheKey(query: string, platform: string): string {
  return `${platform}::${query.toLowerCase()}`;
}

export async function GET(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isGamarrConfigured()) {
    return NextResponse.json({ error: "gamarr is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const platform = (url.searchParams.get("platform") ?? "all").trim();
  if (!query) {
    return NextResponse.json({ error: "A search term is required" }, { status: 400 });
  }

  const key = cacheKey(query, platform);
  const cached = cache.get(key);
  const fresh = cached && cached.expiresAt > Date.now();

  const searchPromise = fresh
    ? cached.promise
    : (() => {
        const p = searchGames(query, platform);
        cache.set(key, { promise: p, expiresAt: Date.now() + CACHE_TTL_MS });
        // A failed search must not poison the cache for the next attempt --
        // drop the entry immediately rather than serving the same error for
        // the full TTL.
        p.catch(() => cache.delete(key));
        return p;
      })();

  try {
    const results = await searchPromise;
    return NextResponse.json({ results, cached: fresh });
  } catch (err) {
    // AbortSignal.timeout surfaces as a TimeoutError; say so plainly rather
    // than showing the raw error, since a timeout here is both common and
    // retryable, unlike a genuine gamarr failure.
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error(`[games] search failed for "${query}":`, err);
    return NextResponse.json(
      {
        error: timedOut
          ? "The search timed out. gamarr queries every indexer and can be slow — try again, or narrow it with a platform filter."
          : err instanceof Error
            ? err.message
            : "Search failed",
      },
      { status: 502 }
    );
  }
}
