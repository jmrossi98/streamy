import { NextResponse } from "next/server";
import { runPlaybackCheck } from "@/lib/playbackCheck";

/**
 * Scheduled trigger for the download -> playback end-to-end check.
 *
 * Called by .github/workflows/playback-check.yml on a cron. No session auth
 * -- a scheduled job can't hold a cookie -- so it is protected by a shared
 * secret in the query string, the same way page-watch and the Radarr/Sonarr
 * webhooks are.
 *
 * Fails closed: with PLAYBACK_CHECK_SECRET unset, every request is rejected.
 *
 * Configure as: https://<host>/api/cron/playback-check?secret=<PLAYBACK_CHECK_SECRET>
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A real download can legitimately take several minutes; give the run room
// rather than have the platform kill it mid-check and leave a test movie
// sitting in the library uncleaned.
export const maxDuration = 900;

function verifySecret(request: Request): boolean {
  const secret = process.env.PLAYBACK_CHECK_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPlaybackCheck();
    // Summary only, no per-stage detail -- this body is echoed into the
    // GitHub Actions log, public on a public repo. Full detail lives in the
    // database (private) and the admin panel.
    return NextResponse.json({ ok: true, success: result.success, summary: result.summary });
  } catch (err) {
    console.error("[cron/playback-check] run failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
