import { NextResponse } from "next/server";
import { runAllChecks } from "@/lib/pageWatch";

/**
 * Scheduled trigger for page watching.
 *
 * Called by .github/workflows/page-watch.yml on a cron. No session auth --
 * a scheduled job can't hold a cookie -- so it is protected by a shared secret
 * in the query string, the same way the Radarr/Sonarr webhooks are.
 *
 * Fails closed: with PAGE_WATCH_SECRET unset, every request is rejected. An
 * unauthenticated endpoint that makes the server fetch arbitrary URLs on demand
 * is not something to leave open by default.
 *
 * Configure as: https://<host>/api/cron/page-watch?secret=<PAGE_WATCH_SECRET>
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fetching several pages sequentially, each with a 20s ceiling.
export const maxDuration = 300;

function verifySecret(request: Request): boolean {
  const secret = process.env.PAGE_WATCH_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAllChecks();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Surfaced rather than swallowed: this one has a human reading the
    // workflow log, unlike the beacon.
    const error = err instanceof Error ? err.message : String(err);
    console.error("[cron/page-watch] run failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
