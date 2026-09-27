import { unstable_noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { getRadarrActiveDownloads, getRadarrCompletedMovies } from "@/lib/radarr";
import {
  getQueuedEpisodeSearches,
  getSonarrActiveDownloads,
  getSonarrCompletedEpisodes,
  maybeDrainEpisodeSearches,
} from "@/lib/sonarr";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { maybeHealStalledDownloads } from "@/lib/downloadHealer";
import { describeRequestNotice } from "@/lib/requestNotice";
import { getRejectionSummary } from "@/lib/rejectedReleases";
import { resolveMediaRequestStatus } from "@/lib/mediaRequests";
import { DownloadsPanel, type DownloadRow } from "@/components/DownloadsPanel";
import { Suspense } from "react";
import { PanelBoundary } from "@/components/PanelBoundary";
import { DownloadRoutingPanel } from "@/components/DownloadRoutingPanel";
import { getGamesList, platformToSlug } from "@/lib/games";
import { getGameDownloads, getWishlist } from "@/lib/gamarr";
import { gameKeyOf } from "@/lib/romNames";
import { GameDownloadsPanel, type GameDownloadRow } from "@/components/GameDownloadsPanel";
import { FlashDownloadsPanel } from "@/components/FlashDownloadsPanel";
import { formatFileSize } from "@/lib/formatBytes";
import { withDeadline } from "@/lib/withDeadline";

/**
 * Every downloads panel, as one block.
 *
 * Lives here rather than on its own page because downloads and storage answer
 * the same question from two directions -- what is arriving, and what it is
 * filling up -- and splitting them across tabs meant checking one to
 * understand the other. The storage chart sits above this.
 */
export async function AdminDownloadsSections() {
  unstable_noStore();

  // The panel auto-refreshes while anything is downloading, so this doubles as
  // a heal loop that doesn't depend on someone sitting on a title page.
  maybeHealStalledDownloads();
  // Resumes an ordered season search that a restart interrupted.
  maybeDrainEpisodeSearches();

  // What the panel may spend gathering before it gives up and renders what it
  // has. The active and queued rows come back in milliseconds; the completed
  // library costs a 2 MB Sonarr history plus two calls per series, and a
  // search-loaded Sonarr can take longer than the browser is willing to wait.
  // Rendering late is indistinguishable from not rendering at all -- the
  // request gets aborted and the page shows nothing, which is what "the
  // refresh button just hangs" was.
  const PANEL_DEADLINE_MS = 6000;

  const [
    radarrDownloads,
    sonarrDownloads,
    radarrCompleted,
    sonarrCompleted,
    queuedSearches,
    pendingRequests,
    gameJobs,
    gameWishlist,
    ownedGames,
    flashDownloads,
  ] = await Promise.all([
    withDeadline(getRadarrActiveDownloads(), [], PANEL_DEADLINE_MS),
    withDeadline(getSonarrActiveDownloads(), [], PANEL_DEADLINE_MS),
    withDeadline(getRadarrCompletedMovies(), [], PANEL_DEADLINE_MS),
    withDeadline(getSonarrCompletedEpisodes(), [], PANEL_DEADLINE_MS),
    // In the same wave: these rows sit at the top of the panel, so resolving
    // them after the rest would leave the newest requests blank the longest.
    withDeadline(getQueuedEpisodeSearches(), [], PANEL_DEADLINE_MS),
    // Requested but not yet picked up by Radarr/Sonarr's own queue -- still
    // searching for a release, and otherwise invisible until it is grabbed.
    prisma.mediaRequest.findMany({ where: { status: { in: ["requested", "noReleaseFound"] } } }),
    withDeadline(getGameDownloads(), [], PANEL_DEADLINE_MS),
    withDeadline(getWishlist(), [], PANEL_DEADLINE_MS),
    withDeadline(getGamesList(), [], PANEL_DEADLINE_MS),
    prisma.flashGame.findMany({
      where: { fileName: { not: null } },
      select: { slug: true, title: true, fileSize: true, storage: true },
      orderBy: { title: "asc" },
    }),
  ]);

  // Straight from gamarr's own downloads/wishlist, not the deduped public
  // games list -- that list deliberately folds a *completed* job into
  // "library" status (it's just an owned game there), but this admin panel
  // needs to keep showing it so a finished download can still be cleared
  // from history, matching the movie/TV downloads panel's own behavior.
  const jobKeys = new Set(gameJobs.map((d) => gameKeyOf(platformToSlug(d.platform), d.title)));
  const gameDownloads: GameDownloadRow[] = [
    ...gameJobs.map((d) => ({
      key: `job-${d.jobId}`,
      title: d.title,
      platform: d.platform,
      status: d.status,
      progress: d.progress,
      error: d.error,
      sizeText: d.sizeHuman,
      jobId: d.jobId,
      wishlistId: null,
      system: null,
      romStem: null,
    })),
    // A wishlist entry gamarr has already turned into a job would otherwise
    // show up twice -- skip any already represented above.
    ...gameWishlist
      .filter((w) => !jobKeys.has(gameKeyOf(w.platformSlug, w.title)))
      .map((w) => ({
        key: `wishlist-${w.id}`,
        title: w.title,
        platform: w.platform,
        status: "queued" as const,
        progress: null,
        error: null,
        sizeText: null,
        jobId: null,
        wishlistId: w.id,
        system: null,
        romStem: null,
      })),
    // Everything actually on disk. The panel is the place to manage what the
    // ROM library holds, not only what's in flight -- an owned game is the
    // only thing there is to delete, and a finished download becomes exactly
    // that. Sorted by title so the list is navigable at ~150 entries.
    ...ownedGames
      .filter((g) => g.status === "library")
      .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle))
      .map((g) => ({
        key: `owned-${g.gameKey}`,
        title: g.displayTitle,
        platform: g.platform,
        status: "owned" as const,
        progress: null,
        error: null,
        sizeText: formatFileSize(g.sizeBytes),
        jobId: null,
        wishlistId: null,
        system: g.system,
        romStem: g.romStem,
      })),
  ];

  const withNotice = (d: (typeof radarrDownloads)[number]) => ({
    ...d,
    completed: false,
    notice: d.unsafe
      ? describeRequestNotice({ status: "downloading", replacing: d.unsafe, rejections: null })
      : null,
  });
  const downloads: DownloadRow[] = [
    ...radarrDownloads.map((d) => ({ ...withNotice(d), mediaType: "movie" as const })),
    ...sonarrDownloads.map((d) => ({ ...withNotice(d), mediaType: "show" as const })),
  ].sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));

  downloads.push(
    ...radarrCompleted.map((d) => ({
      queueId: null,
      externalId: d.id,
      title: d.title,
      progress: null,
      mediaType: "movie" as const,
      completed: true,
      protocol: d.protocol,
      sizeBytes: d.sizeBytes,
      addedAt: d.addedAt,
      startedAt: d.addedAt,
    })),
    ...sonarrCompleted.map((d) => ({
      queueId: null,
      externalId: d.seriesId,
      episodeId: d.episodeId,
      title: d.title,
      progress: null,
      mediaType: "show" as const,
      protocol: d.protocol,
      completed: true,
      sizeBytes: d.sizeBytes,
      addedAt: d.addedAt,
      startedAt: d.addedAt,
    }))
  );

  // Requests still searching -- not yet in Radarr/Sonarr's queue, so absent
  // from everything above. Skip any whose externalId already showed up (a
  // request that got grabbed between the query above and now).
  const representedMovieIds = new Set([
    ...radarrDownloads.map((d) => d.externalId),
    ...radarrCompleted.map((d) => d.id),
  ]);
  const representedShowIds = new Set([
    ...sonarrDownloads.map((d) => d.externalId),
    ...sonarrCompleted.map((d) => d.seriesId),
  ]);
  const stillSearching = pendingRequests.filter((r) =>
    r.externalId != null &&
    (r.mediaType === "movie" ? !representedMovieIds.has(r.externalId) : !representedShowIds.has(r.externalId))
  );
  const searchingRows = await withDeadline(
    Promise.all(
      stillSearching.map(async (r): Promise<DownloadRow | null> => {
        if (r.externalId == null) return null;
        const mediaType = r.mediaType as "movie" | "show";
        // A title that had a release rejected gets its live state re-read, so
        // the panel can say "no release found" the moment that is true rather
        // than whenever a viewer's title page next happens to. Only these: a
        // plain search costs nothing extra, and a plain "no release" was never
        // shown here.
        const rejections = await getRejectionSummary(mediaType, r.externalId).catch(() => null);
        const resolved = rejections ? await resolveMediaRequestStatus(r.tmdbId, mediaType) : null;
        const status = resolved?.status ?? r.status;
        if (r.status === "noReleaseFound" && !rejections) return null;
        // Grabbed, finished or cancelled since -- shown elsewhere or gone.
        if (resolved && status !== "requested" && status !== "noReleaseFound") return null;

        const title =
          mediaType === "movie"
            ? (await getMovieById(r.tmdbId))?.title
            : (await getShowById(r.tmdbId))?.name;
        if (!title) return null;
        const noRelease = status === "noReleaseFound";
        return {
          queueId: null,
          externalId: r.externalId,
          title,
          progress: null,
          mediaType,
          completed: false,
          searching: !noRelease,
          startedAt: r.requestedAt ? new Date(r.requestedAt).toISOString() : null,
          noRelease,
          notice: resolved?.detail.notice ?? null,
        };
      })
    ).then((rows) => rows.filter((r): r is DownloadRow => r != null)),
    // Each of these costs a rejection lookup, a status resolve and a TMDB
    // title, so a handful of pending requests can outlast everything else on
    // the page. They are the least important rows here -- the queued ones
    // above already say the same request was received.
    [],
    PANEL_DEADLINE_MS
  );
  downloads.unshift(...searchingRows);

  // Everything still waiting its turn in the ordered search queue.
  //
  // Shown above the active transfers, not below them: these are the rows a
  // viewer has just asked for and cannot otherwise see at all. A season
  // request is one MediaRequest, so without this, asking for five seasons put
  // a single "Searching..." row on screen while sixty episodes waited
  // invisibly -- which looks exactly like the request was dropped.
  const queuedRows: DownloadRow[] = queuedSearches.map((q) => ({
    queueId: null,
    externalId: q.seriesId,
    episodeId: q.episodeId,
    title: q.title,
    progress: null,
    mediaType: "show" as const,
    completed: false,
    queued: true,
    startedAt: q.enqueuedAt,
    // Only once it has actually failed a round, so a queue that is simply
    // long does not read as a queue that is going wrong.
    notice: q.attempts > 0 ? `Retrying (attempt ${q.attempts + 1})` : null,
  }));
  downloads.unshift(...queuedRows);

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Download routing</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Download routing">
            <Suspense fallback={<p className="py-4 text-sm text-white/30">Reading routing…</p>}>
              <DownloadRoutingPanel />
            </Suspense>
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Downloads">
            <DownloadsPanel downloads={downloads} />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Game downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Game downloads">
            <GameDownloadsPanel downloads={gameDownloads} />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Flash downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Flash downloads">
            <FlashDownloadsPanel rows={flashDownloads} />
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
