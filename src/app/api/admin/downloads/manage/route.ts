import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelRadarrDownload, cancelRadarrQueueItem, deleteRadarrMovie } from "@/lib/radarr";
import {
  cancelSonarrDownload,
  cancelSonarrQueueItem,
  dropQueuedEpisodeSearch,
  deleteSonarrSeries,
  deleteSonarrEpisode,
  getSonarrQueueHealth,
} from "@/lib/sonarr";
import { getRadarrQueueHealth } from "@/lib/radarr";
import { recordRejection } from "@/lib/rejectedReleases";
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
  const queued = body?.queued === true;
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

  // Captured before the cancel, because afterwards the queue entry is gone and
  // with it the release's name -- and the name is what has to be remembered.
  //
  // Without this the cancel undoes itself on a six-hour timer. Cancelling
  // blocklists the release in Sonarr, but the healer expires blocklist entries
  // after BLOCKLIST_TTL_HOURS so a release blocked by a transient stall gets
  // another chance, keeping only those in the rejected table. A hand cancel
  // was never written there, so six hours later the same release became the
  // best-scoring candidate again and was re-grabbed -- observed repeatedly with
  // one Italian-subtitled Gurren Lagann fansub that came back after every
  // cancel. Recording it makes the expiry skip it for good.
  let cancelled: { releaseTitle: string; downloadId: string | null } | null = null;
  if (action === "cancel") {
    try {
      const queue = mediaType === "movie"
        ? await getRadarrQueueHealth()
        : await getSonarrQueueHealth();
      const entry = queue.find((q) =>
        queueId != null ? q.queueId === queueId : q.externalId === id
      );
      if (entry) {
        cancelled = { releaseTitle: entry.title, downloadId: entry.downloadId };
      }
    } catch (err) {
      // A cancel that works but isn't remembered beats refusing to cancel.
      console.error("[downloads] could not read the release being cancelled:", err);
    }
  }

  // A queued episode has been asked for but never searched, so there is no
  // queue entry to remove and nothing to blocklist -- the whole job is to stop
  // wanting it. Taking the branch below instead would cancel the entire
  // series, because a null queueId there means "the series".
  if (action === "cancel" && queued && mediaType === "show" && episodeId != null) {
    const dropped = await dropQueuedEpisodeSearch(episodeId);
    if (!dropped) {
      return NextResponse.json({ error: "Couldn't cancel" }, { status: 404 });
    }
    logAudit(admin.name, `${mediaType}.admin.cancel`, title, "queued for search");
    return NextResponse.json({ ok: true });
  }

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

  // Only once the cancel actually took: recording a release nobody managed to
  // remove would block a release that is still downloading.
  if (cancelled) {
    try {
      await recordRejection({
        mediaType,
        externalId: id,
        releaseTitle: cancelled.releaseTitle,
        downloadId: cancelled.downloadId,
        reason: "cancelledByAdmin",
      });
    } catch (err) {
      console.error("[downloads] could not record the cancelled release:", err);
    }
  }

  // Clear Streamy's own row as well, keyed by the Radarr/Sonarr id this
  // route works in. Without this the title page keeps reporting the old
  // status until status reconciliation catches up, so cancelling from the
  // admin panel looked like it hadn't taken effect.
  await prisma.mediaRequest.deleteMany({ where: { mediaType, externalId: id } });

  logAudit(admin.name, `${mediaType}.admin.${action}`, title);
  return NextResponse.json({ ok: true });
}
