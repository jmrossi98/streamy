import { NextResponse } from "next/server";
import { getGameLibrary } from "@/lib/gamarr";
import { autoFillMissingArt } from "@/lib/gameArtworkAuto";

/**
 * Scheduled trigger that gives every library game a default cover/banner/
 * logo/icon, so the Games grid shows real art instead of the generic
 * placeholder without anyone having to click through the picker for each
 * one. Called by .github/workflows/games-artwork.yml on a cron.
 *
 * Same secret-gated pattern as the other cron endpoints (page-watch,
 * playback-check): no session auth, since a scheduled job can't hold a
 * cookie. Fails closed with GAMES_ARTWORK_CRON_SECRET unset.
 *
 * Cheap on every run after the first: autoFillMissingArt short-circuits to
 * one DB read (no SGDB calls at all) for any game that already has all four
 * kinds, which is every game past its first run. Only genuinely new library
 * entries do real work.
 *
 * Configure as: https://<host>/api/cron/games-artwork?secret=<GAMES_ARTWORK_CRON_SECRET>
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A cold run over a library with many new, never-processed games could do
// up to 5 SGDB calls each; generous but bounded so a slow SGDB spell can't
// hang this indefinitely.
export const maxDuration = 300;

function verifySecret(request: Request): boolean {
  const secret = process.env.GAMES_ARTWORK_CRON_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const library = await getGameLibrary();
    let processed = 0;
    let filledAny = 0;
    for (const g of library) {
      if (!g.system || !g.romStem) continue;
      processed++;
      const { filled } = await autoFillMissingArt(g.system, g.romStem, g.fileName);
      if (filled.length > 0) filledAny++;
    }
    return NextResponse.json({ ok: true, gamesChecked: processed, gamesUpdated: filledAny });
  } catch (err) {
    console.error("[cron/games-artwork] run failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
