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
  removeSonarrEpisodes,
  removeSonarrSeries,
} from "@/lib/sonarr";
import { getRadarrQueueHealth } from "@/lib/radarr";
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

  // A whole show, or one season of it, from the panel's grouped rows: stop
  // everything in flight for it and delete what is on disk, in one go. The
  // single-row paths below each do only one of those, for one entry.
  const scope = body?.scope === "series" || body?.scope === "season" ? body.scope : null;
  if (scope && mediaType === "show") {
    const seasonNumber = typeof body?.seasonNumber === "number" ? body.seasonNumber : null;
    if (scope === "season" && seasonNumber === null) {
      return NextResponse.json({ error: "seasonNumber required" }, { status: 400 });
    }
    const removed =
      scope === "series"
        ? await removeSonarrSeries(id)
        : (await removeSonarrEpisodes(id, seasonNumber!, null)).ok;
    if (!removed) {
      return NextResponse.json({ error: "Couldn't remove" }, { status: 404 });
    }
    // The show's own request row goes with the whole show only: after one
    // season is removed the rest of it is still wanted.
    if (scope === "series") {
      await prisma.mediaRequest.deleteMany({ where: { mediaType, externalId: id } });
    }
    logAudit(
      admin.name,
      `show.admin.remove`,
      title,
      scope === "series" ? "whole series" : `season ${seasonNumber}`
    );
    return NextResponse.json({ ok: true });
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
          // Never blocklisted: a person's cancel means "I don't want this",
          // not "this release is bad". What makes it stick is that the title
          // stops being wanted (unmonitored, queued and running searches
          // stopped) -- see cancelRules.ts. Blocklisting was the old way of
          // making a cancel stick, and it followed the title into any later,
          // deliberate request.
          mediaType === "movie"
          ? await cancelRadarrQueueItem(queueId, { unmonitor: true })
          : await cancelSonarrQueueItem(queueId)
        : mediaType === "movie"
          ? await cancelRadarrDownload(id, { unmonitor: true })
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

  logAudit(admin.name, `${mediaType}.admin.${action}`, title);
  return NextResponse.json({ ok: true });
}
