import { unstable_noStore } from "next/cache";
import { ServicesPanel } from "@/components/ServicesPanel";
import { getServiceStatuses } from "@/lib/serviceStatus";
import { TestAlertButton } from "@/components/TestAlertButton";
import { EpgBackfillButton } from "@/components/EpgBackfillButton";
import { isDispatcharrConfigured } from "@/lib/dispatcharr";
import { isNotifyConfigured } from "@/lib/notify";
import { PanelBoundary } from "@/components/PanelBoundary";
import { PlaybackCheckPanel } from "@/components/PlaybackCheckPanel";
import { getPlaybackCheckHistory } from "@/lib/playbackCheck";
import { HealthProbePanel } from "@/components/HealthProbePanel";
import { ScheduledJobsPanel } from "@/components/ScheduledJobsPanel";
import { fetchCronInventory } from "@/lib/cronInventory";
import { jobHealth, parseProbeDetail } from "@/lib/scheduledJobs";
import { getHealthProbeHistory } from "@/lib/healthProbes";

/**
 * Is anything broken, and is everything that should be running still running.
 *
 * Services and the schedule share a tab because they are two halves of one
 * answer: a service can be up while the job that feeds it has silently stopped,
 * which is exactly how a stale published file went unnoticed for hours.
 */
export default async function AdminHealthPage() {
  unstable_noStore();

  const [services, playbackCheckRuns, healthProbeRuns, cronInventory] = await Promise.all([
    getServiceStatuses().catch(() => []),
    getPlaybackCheckHistory().catch(() => []),
    getHealthProbeHistory().catch(() => []),
    // Null when unreachable, which the panel shows differently from an empty
    // schedule -- "we could not ask" is not "nothing is scheduled".
    fetchCronInventory(),
  ]);

  return (
      <div className="space-y-10">
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
      </div>
  );
}
