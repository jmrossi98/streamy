import Link from "next/link";
import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRadarrActiveDownloads, getRadarrCompletedMovies } from "@/lib/radarr";
import { getSonarrActiveDownloads, getSonarrCompletedEpisodes } from "@/lib/sonarr";
import { getDiskUsage } from "@/lib/diskUsage";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { maybeHealStalledDownloads } from "@/lib/downloadHealer";
import { AdminApprovals } from "@/components/AdminApprovals";
import { StorageChart } from "@/components/StorageChart";
import { DownloadsPanel, type DownloadRow } from "@/components/DownloadsPanel";
import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { isOpenRouterConfigured, openRouterModel } from "@/lib/openrouter";
import { isWebSearchConfigured } from "@/lib/webSearch";
import { runSecurityChecks } from "@/lib/securityChecks";
import { SecurityPanel } from "@/components/SecurityPanel";
import { ServicesPanel } from "@/components/ServicesPanel";
import { SpendPanel } from "@/components/SpendPanel";
import { computeTotals } from "@/lib/spendRules";
import { awsBreakdown, awsMonthToDate, openRouterCredits } from "@/lib/spend";
import { getServiceStatuses } from "@/lib/serviceStatus";
import { TestAlertButton } from "@/components/TestAlertButton";
import { isNotifyConfigured } from "@/lib/notify";
import { VisitorsPanel } from "@/components/VisitorsPanel";
import { getVisitorSummary } from "@/lib/siteVisits";
import { VisitorMapPanel } from "@/components/VisitorMapPanel";
import { BlogEditor } from "@/components/BlogEditor";
import { isBlogPublishingConfigured, listPosts } from "@/lib/githubPublish";
import { PageWatchPanel } from "@/components/PageWatchPanel";
import { getPageWatchSummary } from "@/lib/pageWatch";
import { PlaybackCheckPanel } from "@/components/PlaybackCheckPanel";
import { getPlaybackCheckHistory } from "@/lib/playbackCheck";
import { getGamesList, getGamesStorageSize, platformToSlug } from "@/lib/games";
import { getGameDownloads, getWishlist } from "@/lib/gamarr";
import { gameKeyOf } from "@/lib/romNames";
import { GameDownloadsPanel, type GameDownloadRow } from "@/components/GameDownloadsPanel";
import { FlashDownloadsPanel } from "@/components/FlashDownloadsPanel";
import { getRecentAuditLog } from "@/lib/auditLog";
import { getRecentBadPasswordAttempts } from "@/lib/loginAttempts";
import { formatFileSize } from "@/lib/formatBytes";

export default async function AdminFeaturesPage() {
  // Every fetch below (Radarr/Sonarr's queue chief among them) needs to be
  // genuinely live, not whatever Next cached from the last render. Without
  // this, DownloadsPanel's own 2.5s client poll (router.refresh()) could
  // keep re-rendering the same cached snapshot -- indistinguishable from not
  // polling at all -- while only a full page reload's fresh navigation
  // happened to see new data. Every other page in this app with live data
  // already does this; this one was the one exception.
  unstable_noStore();

  // Authorization comes from the database, not the session's isAdmin claim:
  // a demoted, un-approved, or deleted admin must lose this page immediately
  // rather than when their 30-day token happens to expire.
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  // The panel auto-refreshes while anything is downloading, so this doubles
  // as a heal loop that doesn't depend on someone sitting on a title page.
  maybeHealStalledDownloads();

  const blogConfigured = isBlogPublishingConfigured();

  const [
    pendingUsers,
    diskUsage,
    radarrDownloads,
    sonarrDownloads,
    radarrCompleted,
    sonarrCompleted,
    pendingRequests,
    ollamaStatus,
    security,
    services,
    visitors,
    blogPosts,
    pageWatch,
    playbackCheckRuns,
    gamesSize,
    auditLog,
    recentBadPasswordAttempts,
    gameJobs,
    gameWishlist,
    ownedGames,
    flashDownloads,
    subscriptions,
    awsMtd,
    awsServices,
    openRouter,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { approved: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true },
    }),
    getDiskUsage(),
    getRadarrActiveDownloads(),
    getSonarrActiveDownloads(),
    getRadarrCompletedMovies(),
    getSonarrCompletedEpisodes(),
    // Requested but not yet picked up by Radarr/Sonarr's own queue -- still
    // searching for a release. Without this, a fresh request is invisible in
    // the admin panel for however long the search takes, which read as
    // "doesn't show up until after search" even though it was already in
    // flight the whole time.
    prisma.mediaRequest.findMany({ where: { status: "requested" } }),
    // Probed server-side so an unreachable model shows up on load rather than
    // on the first message.
    isOllamaConfigured() ? getOllamaStatus() : Promise.resolve(null),
    runSecurityChecks(),
    getServiceStatuses(),
    getVisitorSummary("portfolio"),
    // Only to warn before overwriting an existing post. listPosts already
    // swallows its own failures and returns [], so a GitHub outage costs the
    // warning, not the page.
    blogConfigured ? listPosts() : Promise.resolve([]),
    getPageWatchSummary(),
    getPlaybackCheckHistory(),
    // Kept out of the array above and defaulted to 0 on failure (it already
    // swallows its own errors) so an unreachable gamarr can't hold up the
    // rest of this page -- same reasoning the old embedded Games panel used.
    getGamesStorageSize().catch(() => 0),
    getRecentAuditLog(),
    getRecentBadPasswordAttempts(),
    // Same defensive default as getGamesStorageSize above -- an unreachable
    // gamarr shouldn't hold up the rest of this page.
    getGameDownloads().catch(() => []),
    getWishlist().catch(() => []),
    getGamesList().catch(() => []),
    // Every Flash game with a file on disk, so a bad download can be thrown
    // away from here rather than over SSH.
    prisma.flashGame.findMany({
      where: { fileName: { not: null } },
      select: { slug: true, title: true, fileSize: true, storage: true },
      orderBy: { title: "asc" },
    }),
    prisma.subscription.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    // Both swallow their own failures and answer null, so an expired AWS
    // credential or an unreachable OpenRouter costs those figures and not the
    // page. The panel then names what it could not read rather than quietly
    // reporting a total that is too low.
    awsMonthToDate(),
    awsBreakdown(),
    openRouterCredits(),
  ]);

  // AWS and OpenRouter are the only two here that can report themselves.
  // Everything else in the overview is a figure someone typed in, because
  // nothing exposes what a person has signed up for -- which is the whole
  // reason this panel exists.
  const meteredActuals: Record<string, number | null> = {};
  for (const sub of subscriptions) {
    if (sub.cadence !== "metered") continue;
    const name = sub.name.toLowerCase();
    if (name.includes("aws")) meteredActuals[sub.name] = awsMtd;
    else if (name.includes("openrouter")) meteredActuals[sub.name] = openRouter?.used ?? null;
    else meteredActuals[sub.name] = null;
  }

  const spendTotals = computeTotals(subscriptions, meteredActuals);
  const spendRows = subscriptions.map((sub) => ({
    id: sub.id,
    name: sub.name,
    category: sub.category,
    cost: sub.cost,
    cadence: sub.cadence,
    url: sub.url,
    notes: sub.notes,
    active: sub.active,
    actual: meteredActuals[sub.name] ?? null,
  }));

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

  const downloads: DownloadRow[] = [
    ...radarrDownloads.map((d) => ({ ...d, mediaType: "movie" as const, completed: false })),
    ...sonarrDownloads.map((d) => ({ ...d, mediaType: "show" as const, completed: false })),
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
  const searchingRows = (
    await Promise.all(
      stillSearching.map(async (r): Promise<DownloadRow | null> => {
        const title =
          r.mediaType === "movie"
            ? (await getMovieById(r.tmdbId))?.title
            : (await getShowById(r.tmdbId))?.name;
        if (!title || r.externalId == null) return null;
        return {
          queueId: null,
          externalId: r.externalId,
          title,
          progress: null,
          mediaType: r.mediaType as "movie" | "show",
          completed: false,
          searching: true,
        };
      })
    )
  ).filter((r): r is DownloadRow => r != null);
  downloads.unshift(...searchingRows);

  return (
    // Mobile is deliberately untouched: `max-w-2xl` and the vertical stack are
    // what it had, and it reads well at that width. Everything below is
    // lg:-prefixed, so nothing changes until there is desktop width to use.
    <div className="min-h-screen px-4 sm:px-6 pt-24 pb-16 max-w-2xl lg:max-w-6xl 2xl:max-w-[88rem] mx-auto">
      <h1 className="font-display text-3xl font-bold text-white">Admin Features</h1>

      {/*
        Every widget at the container's full width, stacked in one column --
        not a multi-column grid. Order is grouped by responsibility rather
        than by when each was added: overview widgets first (Security,
        Visitors, the map), then Services (what's actually running), then
        the day-to-day admin tools, with the Assistant last since it's the
        one widget here that answers questions about everything above it
        rather than reporting its own thing.
      */}
      <div className="mt-10 space-y-10 lg:mt-8">

      {/* Full width: the audit log is a wide table, and this is the panel
          you scan first. */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Security</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <SecurityPanel
            activity={security.activity}
            findings={security.findings}
            generatedAt={security.generatedAt}
            auditLog={auditLog}
            recentBadPasswordAttempts={recentBadPasswordAttempts}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Visitors</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <VisitorsPanel summary={visitors} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Visitor map</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <VisitorMapPanel />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6 space-y-6">
          <ServicesPanel services={services} />
          <TestAlertButton configured={isNotifyConfigured()} />
          {/* Same section, not its own -- this is itself a health check (the
              one real end-to-end signal: request a title, wait for it to
              actually download, then exercise real playback), so it belongs
              alongside the rest of Services rather than off on its own. */}
          <div className="border-t border-white/10 pt-5">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/30">
              Download &amp; playback check
            </h3>
            <PlaybackCheckPanel runs={playbackCheckRuns} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Spend</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <SpendPanel
            rows={spendRows}
            totals={spendTotals}
            awsBreakdown={awsServices}
            openRouter={openRouter}
          />
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Blog</h2>
          <Link
            href="/admin/blog"
            className="text-sm text-white/50 transition-colors hover:text-white"
          >
            Open full screen →
          </Link>
        </div>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <BlogEditor configured={blogConfigured} existingSlugs={blogPosts.map((b) => b.slug)} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Tour watch</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PageWatchPanel summary={pageWatch} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Pending approvals</h2>
        <AdminApprovals
          users={pendingUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <DownloadsPanel downloads={downloads} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Game downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <GameDownloadsPanel downloads={gameDownloads} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Flash downloads</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <FlashDownloadsPanel rows={flashDownloads} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Storage usage</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          {diskUsage ? (
            <StorageChart
              totalSpace={diskUsage.totalBytes}
              freeSpace={diskUsage.freeBytes}
              moviesSize={diskUsage.categories.movies}
              tvSize={diskUsage.categories.tv}
              gamesSize={gamesSize}
            />
          ) : (
            <p className="text-white/50 text-sm">
              Storage info unavailable — mediabox isn&apos;t reachable.
            </p>
          )}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Assistant</h2>
          <Link
            href="/admin/chat"
            className="text-sm text-white/50 transition-colors hover:text-white"
          >
            Open full screen →
          </Link>
        </div>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <OpsChat
            localAvailable={isOllamaConfigured()}
            remoteAvailable={isOpenRouterConfigured()}
            localModel={ollamaModel()}
            openModel={openRouterModel("open")}
            claudeModel={openRouterModel("claude")}
            statusError={ollamaStatus && !ollamaStatus.ok ? ollamaStatus.error : null}
            searchAvailable={isWebSearchConfigured()}
          />
        </div>
      </section>
      </div>
    </div>
  );
}
