import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isGamarrConfigured, searchGames } from "@/lib/gamarr";

/**
 * Game/ROM search, proxied through Streamy so gamarr itself never needs to be
 * exposed to the browser (it's a homelab-only service with no auth of its own).
 *
 * A search fans out across every configured indexer and measured ~30s live, so
 * this route is deliberately slow by nature -- see gamarr.ts's timeout note.
 * Errors are surfaced with their real message rather than collapsed into an
 * empty result set, since "no results" and "the search timed out" need very
 * different responses from whoever is looking at the screen.
 */
export const dynamic = "force-dynamic";
// The upstream search alone can take ~30s (90s ceiling in gamarr.ts). Node's
// default route timeout would cut that off well before gamarr answers.
export const maxDuration = 120;

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

  try {
    const results = await searchGames(query, platform);
    return NextResponse.json({ results });
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
