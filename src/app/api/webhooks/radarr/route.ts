import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestJellyfinLibraryScan } from "@/lib/jellyfin";

/**
 * Inbound webhook from Radarr (Settings -> Connect -> Webhook).
 * Configure the webhook URL as: https://<host>/api/webhooks/radarr?secret=<MEDIA_WEBHOOK_SECRET>
 * No session auth here (Radarr can't send cookies) — protected by the shared secret only.
 * Fails closed: if MEDIA_WEBHOOK_SECRET isn't set, every request is rejected.
 */
export const dynamic = "force-dynamic";

function verifySecret(request: Request): boolean {
  const secret = process.env.MEDIA_WEBHOOK_SECRET;
  if (!secret) return false;
  return new URL(request.url).searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const movie = body?.movie as { tmdbId?: number } | undefined;
  const tmdbId = movie?.tmdbId != null ? String(movie.tmdbId) : null;
  if (!tmdbId) {
    return NextResponse.json({ ok: true, skipped: "no tmdbId in payload" });
  }

  const eventType = body?.eventType;
  if (eventType === "Grab") {
    await prisma.mediaRequest.updateMany({
      where: { tmdbId, mediaType: "movie", status: "requested" },
      data: { status: "downloading" },
    });
  } else if (eventType === "Download") {
    await prisma.mediaRequest.updateMany({
      where: { tmdbId, mediaType: "movie" },
      data: { status: "available" },
    });
    // Radarr/Sonarr are supposed to notify Jellyfin themselves on import,
    // but that notification doesn't always land -- ask Jellyfin to rescan
    // right away rather than waiting on a viewer's page load to notice the
    // gap and trigger the same (cooldown-limited) request reactively.
    requestJellyfinLibraryScan();
  }
  // Unrecognized event types (Test, MovieDelete, Health, etc.) no-op so
  // Radarr's "Test" button and other lifecycle events don't error out.

  return NextResponse.json({ ok: true });
}
