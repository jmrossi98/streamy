import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelRadarrDownload, cancelRadarrQueueItem, deleteRadarrMovie } from "@/lib/radarr";
import {
  cancelSonarrDownload,
  cancelSonarrQueueItem,
  deleteSonarrSeries,
  deleteSonarrEpisode,
} from "@/lib/sonarr";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const externalId = typeof body?.externalId === "number" ? body.externalId : null;
  const queueId = typeof body?.queueId === "number" ? body.queueId : null;
  const episodeId = typeof body?.episodeId === "number" ? body.episodeId : null;
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : null;
  const action = body?.action === "cancel" || body?.action === "delete" ? body.action : null;
  if (externalId === null || !mediaType || !action) {
    return NextResponse.json(
      { error: "externalId, mediaType, and action required" },
      { status: 400 }
    );
  }

  const id = externalId;
  const ok =
    action === "cancel"
      ? queueId != null
        ? // Target the exact queue entry, so cancelling one episode doesn't
          // take down the rest of the series' downloads with it.
          mediaType === "movie"
          ? await cancelRadarrQueueItem(queueId)
          : await cancelSonarrQueueItem(queueId)
        : mediaType === "movie"
          ? // unmonitor as well, so a cancel from the admin panel sticks
            // rather than being re-grabbed by the idle-title healer
            await cancelRadarrDownload(id, { unmonitor: true })
          : await cancelSonarrDownload(id)
      : mediaType === "movie"
        ? await deleteRadarrMovie(id)
        : episodeId != null
          ? // Completed TV is listed per episode, so delete just that one
            // rather than taking the whole series down with it.
            await deleteSonarrEpisode(episodeId)
          : await deleteSonarrSeries(id);

  if (!ok) {
    return NextResponse.json({ error: `Couldn't ${action}` }, { status: 404 });
  }

  // Clear Streamy's own row as well, keyed by the Radarr/Sonarr id this
  // route works in. Without this the title page keeps reporting the old
  // status until status reconciliation catches up, so cancelling from the
  // admin panel looked like it hadn't taken effect.
  await prisma.mediaRequest.deleteMany({ where: { mediaType, externalId: id } });

  return NextResponse.json({ ok: true });
}
