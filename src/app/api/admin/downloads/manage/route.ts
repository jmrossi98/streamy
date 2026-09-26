import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelRadarrDownload, cancelRadarrQueueItem, deleteRadarrMovie } from "@/lib/radarr";
import {
  cancelSonarrDownload,
  cancelSonarrQueueItem,
  deleteSonarrSeries,
  deleteSonarrEpisode,
} from "@/lib/sonarr";
import { logAudit } from "@/lib/auditLog";

export async function POST(request: Request) {
  // Re-read from the database rather than trusting the JWT's isAdmin claim.
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const externalId = typeof body?.externalId === "number" ? body.externalId : null;
  const queueId = typeof body?.queueId === "number" ? body.queueId : null;
  const episodeId = typeof body?.episodeId === "number" ? body.episodeId : null;
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : null;
  const action = body?.action === "cancel" || body?.action === "delete" ? body.action : null;
  // Audit-log display only -- never used for the action itself.
  const title = typeof body?.title === "string" && body.title ? body.title : `${mediaType ?? "?"} ${externalId ?? "?"}`;
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
          //
          // Blocklisted, because a cancel that does not is a cancel that
          // undoes itself: the release stays the best-scoring candidate, so
          // the next search grabs the same one again. Observed with a 0-seed
          // fansub torrent that returned after every manual cancel.
          //
          // Unmonitoring (below) stops the healer re-searching the title;
          // blocklisting stops Sonarr re-choosing this release. Only the
          // movie path had the first, and neither path had the second.
          mediaType === "movie"
          ? await cancelRadarrQueueItem(queueId, { blocklist: true })
          : await cancelSonarrQueueItem(queueId, { blocklist: true })
        : mediaType === "movie"
          ? await cancelRadarrDownload(id, { unmonitor: true, blocklist: true })
          : await cancelSonarrDownload(id, true)
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

  logAudit(admin.name, `${mediaType}.admin.${action}`, title);
  return NextResponse.json({ ok: true });
}
