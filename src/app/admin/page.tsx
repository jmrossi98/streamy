import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRadarrStorageInfo, getRadarrActiveDownloads, getRadarrCompletedMovies } from "@/lib/radarr";
import { getSonarrTvSize, getSonarrActiveDownloads, getSonarrCompletedEpisodes } from "@/lib/sonarr";
import { getMovieById, getShowById } from "@/lib/tmdb";
import { maybeHealStalledDownloads } from "@/lib/downloadHealer";
import { AdminApprovals } from "@/components/AdminApprovals";
import { StorageChart } from "@/components/StorageChart";
import { DownloadsPanel, type DownloadRow } from "@/components/DownloadsPanel";
import { OpsChat } from "@/components/OpsChat";
import { getOllamaStatus, isOllamaConfigured, ollamaModel } from "@/lib/ollama";
import { isWebSearchConfigured } from "@/lib/webSearch";
import { runSecurityChecks } from "@/lib/securityChecks";
import { SecurityPanel } from "@/components/SecurityPanel";
import { ServicesPanel } from "@/components/ServicesPanel";
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

export default async function AdminFeaturesPage() {
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
    storageInfo,
    tvSize,
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
  ] = await Promise.all([
    prisma.user.findMany({
      where: { approved: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true },
    }),
    getRadarrStorageInfo(),
    getSonarrTvSize(),
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
  ]);

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
    })),
    ...sonarrCompleted.map((d) => ({
      queueId: null,
      externalId: d.seriesId,
      episodeId: d.episodeId,
      title: d.title,
      progress: null,
      mediaType: "show" as const,
      completed: true,
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
    <div className="min-h-screen px-4 sm:px-6 pt-24 pb-16 max-w-2xl mx-auto space-y-10">
      <h1 className="font-display text-3xl font-bold text-white">Admin Features</h1>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Security</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <SecurityPanel
            activity={security.activity}
            findings={security.findings}
            generatedAt={security.generatedAt}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <ServicesPanel services={services} />
          <TestAlertButton configured={isNotifyConfigured()} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Portfolio visitors</h2>
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
            configured={isOllamaConfigured()}
            model={ollamaModel()}
            statusError={ollamaStatus && !ollamaStatus.ok ? ollamaStatus.error : null}
            searchAvailable={isWebSearchConfigured()}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Storage usage</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          {storageInfo ? (
            <StorageChart
              totalSpace={storageInfo.totalSpace}
              freeSpace={storageInfo.freeSpace}
              moviesSize={storageInfo.moviesSize}
              tvSize={tvSize ?? 0}
            />
          ) : (
            <p className="text-white/50 text-sm">
              Storage info unavailable — Radarr isn&apos;t configured or unreachable.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
