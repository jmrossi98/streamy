import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requestMovie, isRadarrConfigured, searchRadarrMovie } from "@/lib/radarr";
import { requestShow, isSonarrConfigured, searchSonarrSeries } from "@/lib/sonarr";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { logAudit } from "@/lib/auditLog";

export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actorName = session?.user?.name ?? "unknown";

  const body = await request.json();
  const tmdbId = body?.tmdbId != null ? String(body.tmdbId).trim() : "";
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : "";
  if (!tmdbId || !mediaType) {
    return NextResponse.json({ error: "tmdbId and mediaType required" }, { status: 400 });
  }

  // Idempotent and shared across every user: repeated clicks / re-mounts / a
  // different user clicking the same title all just return the current state
  // instead of re-hitting Radarr/Sonarr -- except "noReleaseFound", which is
  // a dead end until something actually changes. A click there is a genuine
  // "search again" request (the UI's "Search again" affordance), not a
  // duplicate of the original one, so it's worth actually re-searching
  // rather than just handing back the same stale answer.
  const existing = await prisma.mediaRequest.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (existing && existing.status !== "noReleaseFound") {
    return NextResponse.json({ status: existing.status });
  }
  // Best-effort, and only once we know a request is actually about to
  // mutate something -- the early "already requested" return above skips
  // it entirely, so a repeated click doesn't cost a TMDB round trip.
  const titleFor = async () =>
    (mediaType === "movie" ? (await getMovieById(tmdbId))?.title : (await getShowById(tmdbId))?.name) ??
    `${mediaType} ${tmdbId}`;

  if (existing && existing.externalId != null) {
    if (mediaType === "movie") await searchRadarrMovie(existing.externalId);
    else await searchSonarrSeries(existing.externalId);
    await prisma.mediaRequest.update({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      data: { status: "requested" },
    });
    logAudit(actorName, `${mediaType}.request.retry`, await titleFor());
    return NextResponse.json({ status: "requested" });
  }

  let status: string;

  if (mediaType === "movie") {
    if (!isRadarrConfigured()) {
      return NextResponse.json({ error: "Radarr is not configured" }, { status: 503 });
    }
    const result = await requestMovie(tmdbId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    status = result.status;
    await prisma.mediaRequest.create({
      data: { tmdbId, mediaType, externalId: result.radarrId, status },
    });
  } else {
    if (!isSonarrConfigured()) {
      return NextResponse.json({ error: "Sonarr is not configured" }, { status: 503 });
    }
    const result = await requestShow(tmdbId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    status = result.status;
    await prisma.mediaRequest.create({
      data: { tmdbId, mediaType, tvdbId: String(result.tvdbId), externalId: result.sonarrId, status },
    });
  }

  logAudit(actorName, `${mediaType}.request`, await titleFor());
  return NextResponse.json({ status });
}
