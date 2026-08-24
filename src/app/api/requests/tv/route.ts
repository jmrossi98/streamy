import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import {
  isSonarrConfigured,
  requestEpisode,
  requestSeason,
  getSonarrSeasonStatuses,
} from "@/lib/sonarr";

/** Per-episode status for one season. Shared library state, so no session needed. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("tmdbId");
  const seasonNumber = Number.parseInt(searchParams.get("season") ?? "", 10);
  if (!tmdbId || Number.isNaN(seasonNumber)) {
    return NextResponse.json({ statuses: {} });
  }
  const statuses = await getSonarrSeasonStatuses(tmdbId, seasonNumber);
  return NextResponse.json({ statuses });
}

/**
 * Requests a single episode, or a whole season when `episodeNumber` is
 * omitted. Any signed-in user may trigger this, same as the movie flow.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSonarrConfigured()) {
    return NextResponse.json({ error: "Sonarr is not configured" }, { status: 503 });
  }

  const body = await request.json();
  const tmdbId = body?.tmdbId != null ? String(body.tmdbId).trim() : "";
  const seasonNumber = Number(body?.seasonNumber);
  const hasEpisode = body?.episodeNumber != null;
  const episodeNumber = Number(body?.episodeNumber);

  if (!tmdbId || Number.isNaN(seasonNumber) || (hasEpisode && Number.isNaN(episodeNumber))) {
    return NextResponse.json({ error: "tmdbId and seasonNumber required" }, { status: 400 });
  }

  const result = hasEpisode
    ? await requestEpisode(tmdbId, seasonNumber, episodeNumber)
    : await requestSeason(tmdbId, seasonNumber);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: "requested" });
}
