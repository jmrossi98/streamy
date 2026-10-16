import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { setRadarrMovieMonitored, searchRadarrMovie } from "@/lib/radarr";
import { monitorSonarrEpisodes, searchSonarrEpisodes } from "@/lib/sonarr";
import { episodeKey, movieKey, resetSearches } from "@/lib/wantedSearches";
import { retryTargets, type RetryTarget } from "@/lib/searchGiveUpRules";
import { logAudit } from "@/lib/auditLog";

/**
 * An admin's Retry on titles the healer gave up on (searchGiveUpRules.ts):
 * want them again, forget their search count so the healer starts over, and
 * search now rather than on the healer's next pass.
 *
 * Body: { rows: [{ mediaType, externalId, episodeId? }], title }.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin(await getSession());
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rows: RetryTarget[] = (Array.isArray(body?.rows) ? body.rows : [])
    .filter(
      (r: unknown): r is { mediaType: "movie" | "show"; externalId: number; episodeId?: unknown } =>
        typeof r === "object" &&
        r !== null &&
        ((r as RetryTarget).mediaType === "movie" || (r as RetryTarget).mediaType === "show") &&
        typeof (r as RetryTarget).externalId === "number"
    )
    // Only given-up rows are ever sent; the flag is set here so the shared
    // rule does the grouping and nothing else.
    .map((r: { mediaType: "movie" | "show"; externalId: number; episodeId?: unknown }) => ({
      mediaType: r.mediaType,
      externalId: r.externalId,
      episodeId: typeof r.episodeId === "number" ? r.episodeId : null,
      gaveUp: true,
    }));
  const title = typeof body?.title === "string" && body.title ? body.title : "given-up downloads";
  const { movies, episodes } = retryTargets(rows);
  if (movies.length === 0 && episodes.size === 0) {
    return NextResponse.json({ error: "nothing to retry" }, { status: 400 });
  }

  try {
    // Wanted again first: if that fails, the give-up stays listed as it was.
    for (const id of movies) await setRadarrMovieMonitored(id, true);
    const allEpisodes = [...episodes.values()].flat();
    await monitorSonarrEpisodes(allEpisodes);
    await resetSearches([...movies.map(movieKey), ...allEpisodes.map(episodeKey)]);
    for (const id of movies) await searchRadarrMovie(id);
    for (const ids of episodes.values()) await searchSonarrEpisodes(ids);
  } catch (err) {
    console.error(`[downloads] retry of "${title}" failed:`, err);
    return NextResponse.json({ error: "Radarr/Sonarr did not answer" }, { status: 502 });
  }

  const count = movies.length + [...episodes.values()].reduce((n, ids) => n + ids.length, 0);
  await logAudit(admin.name, "downloads.retry", title, `${count} given up, searching again`);
  return NextResponse.json({ ok: true, count });
}
