import { Suspense } from "react";
import { unstable_noStore } from "next/cache";
import { getDiskUsage } from "@/lib/diskUsage";
import { StorageChart } from "@/components/StorageChart";
import { runSecurityChecks } from "@/lib/securityChecks";
import { SecurityPanel } from "@/components/SecurityPanel";
import { ServicesPanel } from "@/components/ServicesPanel";
import { SpendPanel } from "@/components/SpendPanel";
import { computeTotals, daysUntil } from "@/lib/spendRules";
import { awsSpend, openRouterCredits } from "@/lib/spend";
import { getAutomaticRenewals } from "@/lib/renewals";
import { getServiceStatuses } from "@/lib/serviceStatus";
import { TestAlertButton } from "@/components/TestAlertButton";
import { EpgBackfillButton } from "@/components/EpgBackfillButton";
import { isDispatcharrConfigured } from "@/lib/dispatcharr";
import { isNotifyConfigured } from "@/lib/notify";
import { VisitorsPanel } from "@/components/VisitorsPanel";
import { getVisitorSummary } from "@/lib/siteVisits";
import { VisitorMapPanel } from "@/components/VisitorMapPanel";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { DownloadRoutingPanel } from "@/components/DownloadRoutingPanel";
import { PanelBoundary } from "@/components/PanelBoundary";
import { PlaybackCheckPanel } from "@/components/PlaybackCheckPanel";
import { getPlaybackCheckHistory } from "@/lib/playbackCheck";
import { HealthProbePanel } from "@/components/HealthProbePanel";
import { ScheduledJobsPanel } from "@/components/ScheduledJobsPanel";
import { fetchCronInventory } from "@/lib/cronInventory";
import { jobHealth, parseProbeDetail } from "@/lib/scheduledJobs";
import { getHealthProbeHistory } from "@/lib/healthProbes";
import { getGamesStorageSize } from "@/lib/games";
import { getRecentAuditLog } from "@/lib/auditLog";
import { prisma } from "@/lib/db";

export default async function AdminDashboardPage() {
  // Never a cached snapshot: several of these panels are polled by the client
  // and a cached render is indistinguishable from a panel that stopped updating.
  unstable_noStore();

  const [
    security,
    auditLog,
    visitors,
    services,
    playbackCheckRuns,
    healthProbeRuns,
    cronInventory,
    diskUsage,
    gamesSize,
    subscriptions,
    aws,
    openRouter,
    autoRenewals,
  ] = await Promise.all([
    runSecurityChecks(),
    getRecentAuditLog().catch(() => []),
    getVisitorSummary("portfolio"),
    getServiceStatuses().catch(() => []),
    getPlaybackCheckHistory().catch(() => []),
    getHealthProbeHistory().catch(() => []),
    // Null when unreachable, which the panel shows differently from an empty
    // schedule -- "we could not ask" is not "nothing is scheduled".
    fetchCronInventory(),
    getDiskUsage(),
    getGamesStorageSize().catch(() => 0),
    prisma.subscription.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    awsSpend(),
    openRouterCredits(),
    getAutomaticRenewals(),
  ]);

  // AWS and OpenRouter are the only two here that can report themselves.
  // Everything else in the overview is a figure someone typed in, because
  // nothing exposes what a person has signed up for -- which is the whole
  // reason this panel exists.
  const meteredActuals: Record<string, number | null> = {};
  for (const sub of subscriptions) {
    if (sub.cadence !== "metered") continue;
    const name = sub.name.toLowerCase();
    if (name.includes("aws")) meteredActuals[sub.name] = aws.ok ? aws.monthToDate : null;
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
    renewsAt: sub.renewsAt?.toISOString() ?? null,
    // Computed here rather than in the panel so the row carries its own
    // expiry, which is what let the separate renewals list go away.
    daysLeft: sub.renewsAt ? daysUntil(sub.renewsAt.toISOString()) : null,
  }));

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Security</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Security">
            <SecurityPanel
              activity={security.activity}
              findings={security.findings}
              generatedAt={security.generatedAt}
              auditLog={auditLog}
            />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Visitors</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Visitors">
            <VisitorsPanel summary={visitors} />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Visitor map</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Visitor map">
            <VisitorMapPanel />
          </PanelBoundary>
        </div>
      </section>

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
        <h2 className="text-lg font-semibold text-white mb-4">Connections</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Connections">
            {/* Its own Suspense boundary: this reads a 24-hour history over the
                tailnet, and the rest of the admin page has no reason to wait on
                a chart. */}
            <Suspense fallback={<p className="py-8 text-center text-sm text-white/30">Loading metrics…</p>}>
              <ConnectionsPanel />
            </Suspense>
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Services</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6 space-y-6">
          <PanelBoundary name="Services">
            <ServicesPanel services={services} />
            <TestAlertButton configured={isNotifyConfigured()} />
            <EpgBackfillButton configured={isDispatcharrConfigured()} />
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
            {/* Also Services, for the same reason: these probe every
                dependency the stack has (Sonarr, Radarr, indexers, the
                published status files), so they answer "is anything broken"
                one section down from the services list itself. */}
            <div className="border-t border-white/10 pt-5">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/30">
                Dependency probes
              </h3>
              <HealthProbePanel
                runs={healthProbeRuns.map((run) => ({
                  ...run,
                  // Date -> string at the server/client boundary, matching the
                  // playback panel next door.
                  ranAt: run.ranAt.toISOString(),
                }))}
              />
            </div>
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Scheduled</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Scheduled">
            <ScheduledJobsPanel
              probes={parseProbeDetail(healthProbeRuns[0]?.detail)}
              probeRanAt={healthProbeRuns[0]?.ranAt.toISOString() ?? null}
              cronGeneratedAt={cronInventory?.generatedAt ?? null}
              cronReachable={cronInventory !== null}
              jobs={(cronInventory?.jobs ?? []).map((job) => ({
                name: job.name,
                user: job.user,
                schedule: job.schedule,
                command: job.command,
                lastRun: job.lastRun,
                lastOutput: job.lastOutput ?? null,
                health: jobHealth(job),
              }))}
            />
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Spend</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Spend">
            <div className="space-y-4">
              <SpendPanel
                rows={spendRows}
                totals={spendTotals}
                aws={aws}
                openRouter={openRouter}
                autoRenewals={autoRenewals}
              />
            </div>
          </PanelBoundary>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Storage usage</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Storage usage">
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
                Storage info unavailable - mediabox isn&apos;t reachable.
              </p>
            )}
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
