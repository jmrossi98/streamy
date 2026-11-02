import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId, requireAdmin } from "@/lib/auth";
import { tierForUser } from "@/lib/qualityTier";
import { getNewEpisodeFollow, isSonarrConfigured, setNewEpisodeFollow } from "@/lib/sonarr";
import { getShowById } from "@/lib/tmdb";
import { logAudit } from "@/lib/auditLog";

/**
 * Whether a show's new episodes download as they air -- one setting per show,
 * shared by everyone, because Sonarr keeps one copy for all. See
 * newEpisodeRules.ts. Never cached: it is live Sonarr state.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tmdbId = new URL(request.url).searchParams.get("tmdbId")?.trim();
  if (!tmdbId) return NextResponse.json({ error: "tmdbId required" }, { status: 400 });
  if (!isSonarrConfigured()) return NextResponse.json({ following: false, nextAiring: null });
  try {
    return NextResponse.json(await getNewEpisodeFollow(tmdbId), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error(`[requests/tv/follow] could not read ${tmdbId}:`, err);
    return NextResponse.json({ error: "Could not reach Sonarr" }, { status: 502 });
  }
}

/** Turns it on or off. Any signed-in user, same as requesting an episode. */
export async function PUT(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSonarrConfigured()) return NextResponse.json({ error: "Sonarr is not configured" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const tmdbId = body?.tmdbId != null ? String(body.tmdbId).trim() : "";
  if (!tmdbId || typeof body?.following !== "boolean") {
    return NextResponse.json({ error: "tmdbId and following required" }, { status: 400 });
  }
  const on: boolean = body.following;

  // A show this adds to Sonarr gets the same quality as a request would.
  const tier = tierForUser((await requireAdmin(session)) !== null);
  const result = await setNewEpisodeFollow(tmdbId, on, tier);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  const title = (await getShowById(tmdbId).catch(() => null))?.name ?? `show ${tmdbId}`;
  logAudit(session?.user?.name ?? "unknown", on ? "show.follow.on" : "show.follow.off", title, on ? `new episodes (${tier})` : "new episodes");
  return NextResponse.json(result.follow);
}
