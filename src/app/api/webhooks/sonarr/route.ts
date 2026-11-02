import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshJellyfinShowNow, requestJellyfinLibraryScan, requestJellyfinPathScan } from "@/lib/jellyfin";
import { dropDuplicateGrab } from "@/lib/sonarr";

/**
 * Inbound webhook from Sonarr (Settings -> Connect -> Webhook).
 * Configure the webhook URL as: https://<host>/api/webhooks/sonarr?secret=<MEDIA_WEBHOOK_SECRET>
 * Sonarr's payload carries tvdbId, not tmdbId, so requests are matched on the
 * tvdbId we cached on the MediaRequest row when the request was created.
 * No session auth here (Sonarr can't send cookies) — protected by the shared secret only.
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

  const series = body?.series as { tvdbId?: number } | undefined;
  const tvdbId = series?.tvdbId != null ? String(series.tvdbId) : null;
  if (!tvdbId) {
    return NextResponse.json({ ok: true, skipped: "no tvdbId in payload" });
  }

  const eventType = body?.eventType;
  if (eventType === "Grab") {
    await prisma.mediaRequest.updateMany({
      where: { tvdbId, mediaType: "show", status: "requested" },
      data: { status: "downloading" },
    });
    // A second copy of something already on disk or on its way is taken
    // back out -- see duplicateGrabRules.ts. In the background: the queue
    // entry it needs shows up a few seconds after this call.
    const seriesId = (body?.series as { id?: number } | undefined)?.id;
    const episodeIds = ((body?.episodes as { id?: number }[] | undefined) ?? [])
      .map((e) => e.id)
      .filter((id): id is number => typeof id === "number");
    const downloadId = typeof body?.downloadId === "string" ? body.downloadId : "";
    const title = (body?.release as { releaseTitle?: string } | undefined)?.releaseTitle ?? "unknown release";
    if (typeof seriesId === "number" && downloadId && episodeIds.length > 0) {
      void dropDuplicateGrab({ seriesId, episodeIds, downloadId, title });
    }
  } else if (eventType === "Download") {
    await prisma.mediaRequest.updateMany({
      where: { tvdbId, mediaType: "show" },
      data: { status: "available" },
    });
    // See the Radarr twin -- Sonarr's own Jellyfin notification doesn't
    // always land either. Just the series folder, not the whole library.
    const seriesPath = (body?.series as { path?: string } | undefined)?.path;
    if (typeof seriesPath === "string" && seriesPath) requestJellyfinPathScan(seriesPath);
    else requestJellyfinLibraryScan();
    // And the show itself straight away, rather than after the path scan's
    // one-minute wait, so a new episode plays within seconds of landing.
    const tmdbId = (body?.series as { tmdbId?: number } | undefined)?.tmdbId;
    void refreshJellyfinShowNow({ tmdbId: tmdbId ? String(tmdbId) : null, tvdbId });
  }
  // Unrecognized event types (Test, SeriesDelete, Health, etc.) no-op so
  // Sonarr's "Test" button and other lifecycle events don't error out.

  return NextResponse.json({ ok: true });
}
