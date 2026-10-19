import { unstable_noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { getRadarrActiveDownloads, getRadarrCompletedMovies } from "@/lib/radarr";
import {
  getQueuedEpisodeSearches,
  getSonarrActiveDownloads,
  getSonarrCompletedEpisodes,
  maybeDrainEpisodeSearches,
  getSonarrSeriesPlaces,
  getSonarrWantedSeriesIds,
} from "@/lib/sonarr";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { maybeHealStalledDownloads } from "@/lib/downloadHealer";
import { describeRequestNotice } from "@/lib/requestNotice";
import { getRejectionSummary } from "@/lib/rejectedReleases";
import { resolveMediaRequestStatus } from "@/lib/mediaRequests";
import { DownloadsPanel, type DownloadRow } from "@/components/DownloadsPanel";
import { PanelBoundary } from "@/components/PanelBoundary";
import { getGamesList, platformToSlug } from "@/lib/games";
import { getGameDownloads, getWishlist } from "@/lib/gamarr";
import { gameKeyOf } from "@/lib/romNames";
import { GameDownloadsPanel, type GameDownloadRow } from "@/components/GameDownloadsPanel";
import { FlashDownloadsPanel } from "@/components/FlashDownloadsPanel";
import { formatFileSize } from "@/lib/formatBytes";
import { withDeadline } from "@/lib/withDeadline";
import { getClientProgress } from "@/lib/clientProgress";
import { withClientProgress } from "@/lib/liveProgressRules";
import { foldPacks } from "@/lib/downloadGroupRules";
import { episodeLabel, placeFromLabel } from "@/lib/wantedEpisodeRules";
import { recentGiveUps } from "@/lib/wantedSearches";
import { giveUpNotice } from "@/lib/searchGiveUpRules";

/**
 * Every downloads panel, as one block.
 *
 * Shares the Downloads tab with the storage chart because the two answer the
 * same question from two directions -- what is arriving, and what it is
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
    radarrQueue,
    sonarrQueue,
    clientProgress,
    radarrCompleted,
    sonarrCompleted,
    queuedSearches,
    pendingRequests,
    requestTimes,
    gameJobs,
    gameWishlist,
    ownedGames,
    flashDownloads,
  ] = await Promise.all([
    withDeadline(getRadarrActiveDownloads(), [], PANEL_DEADLINE_MS),
    withDeadline(getSonarrActiveDownloads(), [], PANEL_DEADLINE_MS),
    // The clients' own figure for each transfer: the *arrs' lags their serial
    // command queue, minutes behind a season search (liveProgressRules.ts).
    withDeadline(getClientProgress(), new Map(), PANEL_DEADLINE_MS),
    withDeadline(getRadarrCompletedMovies(), [], PANEL_DEADLINE_MS),
    withDeadline(getSonarrCompletedEpisodes(), [], PANEL_DEADLINE_MS),
    // In the same wave: these rows sit at the top of the panel, so resolving
    // them after the rest would leave the newest requests blank the longest.
    withDeadline(getQueuedEpisodeSearches(), [], PANEL_DEADLINE_MS),
    // Requested but not yet picked up by Radarr/Sonarr's own queue -- still
    // searching for a release, and otherwise invisible until it is grabbed.
    prisma.mediaRequest.findMany({ where: { status: { in: ["requested", "noReleaseFound"] } } }),
    // When each title was asked for, for stamping in-flight rows the download
    // client gives no grab time for.
    prisma.mediaRequest
      .findMany({
        where: { externalId: { not: null } },
        select: { mediaType: true, externalId: true, requestedAt: true, status: true },
      })
      .catch(() => []),
    withDeadline(getGameDownloads(), [], PANEL_DEADLINE_MS),
    withDeadline(getWishlist(), [], PANEL_DEADLINE_MS),
    withDeadline(getGamesList(), [], PANEL_DEADLINE_MS),
    prisma.flashGame.findMany({
      where: { fileName: { not: null } },
      select: { slug: true, title: true, fileSize: true, storage: true },
      orderBy: { title: "asc" },
    }),
  ]);

  const radarrDownloads = withClientProgress(radarrQueue, clientProgress);
  const sonarrDownloads = withClientProgress(sonarrQueue, clientProgress);

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
  // When Streamy kicked the download off. The queue's own grab time wins when
  // it has one; this covers the rows it leaves blank.
  const requestedAt = new Map<string, string>();
  for (const r of requestTimes) {
    if (r.externalId != null && r.requestedAt) {
      requestedAt.set(`${r.mediaType}:${r.externalId}`, new Date(r.requestedAt).toISOString());
    }
  }
  const downloads: DownloadRow[] = [
    ...radarrDownloads.map((d) => ({
      ...withNotice(d),
      mediaType: "movie" as const,
      startedAt: d.startedAt ?? requestedAt.get(`movie:${d.externalId}`) ?? null,
    })),
    ...sonarrDownloads.map((d) => ({
      ...withNotice(d),
      mediaType: "show" as const,
      startedAt: d.startedAt ?? requestedAt.get(`show:${d.externalId}`) ?? null,
    })),
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
    // A batched episode is being searched right now, as part of its season;
    // "Queued" would say it was waiting when it is not.
    queued: !q.batched,
    searching: q.batched,
    startedAt: q.enqueuedAt,
    // Only once it has actually failed a round, so a queue that is simply
    // long does not read as a queue that is going wrong.
    notice: q.attempts > 0 ? `Retrying (attempt ${q.attempts + 1})` : null,
  }));
  downloads.unshift(...queuedRows);

  // Where each TV row sits in its show, so the panel can fold them into
  // shows and seasons. Unplaced rows still render, under the show's "Other".
  // Shows that are not finished. Read even when nothing of theirs has a row
  // yet, for the episodes added just below. Sonarr's wanted list is what says
  // so; the request alone turns "available" at its first file, which hid the
  // rest of a long show as soon as one episode had landed.
  const activeShowIds = [
    ...requestTimes
      .filter((r) => r.mediaType === "show" && (r.status === "requested" || r.status === "downloading"))
      .map((r) => r.externalId)
      .filter((id): id is number => id != null),
    ...(await withDeadline(getSonarrWantedSeriesIds(), [], PANEL_DEADLINE_MS)),
  ];
  const places = await withDeadline(
    getSonarrSeriesPlaces([...downloads.filter((d) => d.mediaType === "show").map((d) => d.externalId), ...activeShowIds]),
    new Map(),
    PANEL_DEADLINE_MS
  );

  // Every episode a requested show is still owed, whether or not anything has
  // a row for it. Without these a show appeared only as far as the search
  // queue or Sonarr's own queue had got: a whole series asked for and one
  // season listed -- see wantedEpisodeRules.ts.
  const listedEpisodes = new Set(downloads.map((d) => d.episodeId).filter((id) => id != null));
  const showsWithWanted = new Set<number>();
  const wantedRows: DownloadRow[] = [];
  for (const seriesId of new Set(activeShowIds)) {
    const series = places.get(seriesId);
    if (!series) continue;
    for (const e of series.wanted) {
      showsWithWanted.add(seriesId);
      if (listedEpisodes.has(e.episodeId)) continue;
      wantedRows.push({
        queueId: null,
        externalId: seriesId,
        episodeId: e.episodeId,
        title: episodeLabel(series.title, e),
        progress: null,
        mediaType: "show" as const,
        completed: false,
        queued: true,
        startedAt: requestedAt.get(`show:${seriesId}`) ?? null,
      });
    }
  }
  downloads.unshift(...wantedRows);

  // Titles the healer stopped looking for -- see searchGiveUpRules.ts. Listed
  // for a few days so a show that lost episodes says where they went, rather
  // than them simply vanishing from "queued". One asked for again since is
  // wanted again and already has a row above.
  const listedNow = new Set(downloads.map((d) => `${d.mediaType}:${d.externalId}:${d.episodeId ?? ""}`));
  const givenUp = await withDeadline(recentGiveUps(), [], PANEL_DEADLINE_MS);
  downloads.unshift(
    ...givenUp
      .filter((g) => !listedNow.has(`${g.mediaType}:${g.externalId}:${g.episodeId ?? ""}`))
      .map((g): DownloadRow => ({
        queueId: null,
        externalId: g.externalId,
        episodeId: g.episodeId ?? undefined,
        title: g.label,
        progress: null,
        mediaType: g.mediaType,
        completed: false,
        noRelease: true,
        gaveUp: true,
        startedAt: g.gaveUpAt.toISOString(),
        notice: giveUpNotice(g),
      }))
  );
  // The one whole-show "Searching..." row says nothing its episodes do not,
  // and with no episode to belong to it sat alone under "Other".
  for (let i = downloads.length - 1; i >= 0; i--) {
    const d = downloads[i];
    if (d.mediaType === "show" && d.episodeId == null && d.queueId == null && d.searching && showsWithWanted.has(d.externalId)) {
      downloads.splice(i, 1);
    }
  }
  for (const d of downloads) {
    if (d.mediaType !== "show") continue;
    const series = places.get(d.externalId);
    if (!series) {
      // Sonarr did not answer for this show; a queued row still names its
      // own season and episode.
      const fromLabel = placeFromLabel(d.title);
      if (fromLabel) {
        d.seriesTitle = fromLabel.seriesTitle;
        d.seasonNumber = fromLabel.seasonNumber;
        d.episodeNumber = fromLabel.episodeNumber;
      }
      continue;
    }
    d.seriesTitle = series.title;
    d.seriesEpisodes = series.total;
    // The label again when the list does not have the episode: a show added
    // a minute ago can be read before Sonarr has finished filling it in.
    const place =
      (d.episodeId != null ? series.episodes.get(d.episodeId) : undefined) ?? placeFromLabel(d.title) ?? undefined;
    d.seasonNumber = place?.seasonNumber ?? null;
    d.episodeNumber = place?.episodeNumber ?? null;
  }

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Downloads">
            <DownloadsPanel downloads={foldPacks(downloads)} />
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
