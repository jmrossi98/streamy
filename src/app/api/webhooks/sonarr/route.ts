import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  } else if (eventType === "Download") {
    await prisma.mediaRequest.updateMany({
      where: { tvdbId, mediaType: "show" },
      data: { status: "available" },
    });
  }
  // Unrecognized event types (Test, SeriesDelete, Health, etc.) no-op so
  // Sonarr's "Test" button and other lifecycle events don't error out.

  return NextResponse.json({ ok: true });
}
