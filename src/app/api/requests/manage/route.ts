import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelRadarrDownload, deleteRadarrMovie } from "@/lib/radarr";
import { cancelSonarrDownload, deleteSonarrSeries } from "@/lib/sonarr";

// Cancelling/deleting is intentionally available to any signed-in approved
// user (not just admins) from the title page -- so a stuck or unwanted
// download never requires the admin to step in.
export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const tmdbId = body?.tmdbId != null ? String(body.tmdbId).trim() : "";
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : "";
  const action = body?.action === "cancel" || body?.action === "delete" ? body.action : "";
  if (!tmdbId || !mediaType || !action) {
    return NextResponse.json({ error: "tmdbId, mediaType, and action required" }, { status: 400 });
  }

  const row = await prisma.mediaRequest.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (!row || !row.externalId) {
    return NextResponse.json({ error: "No request found for this title" }, { status: 404 });
  }

  const ok =
    action === "cancel"
      ? mediaType === "movie"
        ? // unmonitor too, so Radarr stops wanting it and the idle-title
          // healer doesn't turn round and re-grab what was just cancelled
          await cancelRadarrDownload(row.externalId, { unmonitor: true })
        : await cancelSonarrDownload(row.externalId)
      : mediaType === "movie"
        ? await deleteRadarrMovie(row.externalId)
        : await deleteSonarrSeries(row.externalId);

  if (!ok) {
    return NextResponse.json({ error: `Couldn't ${action} -- try again` }, { status: 502 });
  }

  await prisma.mediaRequest.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
  return NextResponse.json({ ok: true });
}
