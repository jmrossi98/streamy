import { Suspense } from "react";
import { unstable_noStore } from "next/cache";
import { AdminSection } from "@/components/ui";
import { ServicesPanel } from "@/components/ServicesPanel";
import { getServiceStatuses } from "@/lib/serviceStatus";
import { TestAlertButton } from "@/components/TestAlertButton";
import { EpgBackfillButton } from "@/components/EpgBackfillButton";
import { isDispatcharrConfigured } from "@/lib/dispatcharr";
import { isNotifyConfigured } from "@/lib/notify";
import { PlaybackCheckPanel } from "@/components/PlaybackCheckPanel";
import { getPlaybackCheckHistory } from "@/lib/playbackCheck";
import { HealthProbePanel } from "@/components/HealthProbePanel";
import { ScheduledJobsPanel } from "@/components/ScheduledJobsPanel";
import { fetchCronInventory } from "@/lib/cronInventory";
import { jobHealth, parseProbeDetail } from "@/lib/scheduledJobs";
import { getHealthProbeHistory } from "@/lib/healthProbes";
import { PanelWaiting } from "@/components/PanelWaiting";

/**
 * Is anything broken, and is everything that should be running still running.
 *
 * Services and the schedule share a tab because they are two halves of one
 * answer: a service can be up while the job that feeds it has silently stopped,
 * which is exactly how a stale published file went unnoticed for hours.
 *
 * Each block streams in when its own data is ready. The services list runs
 * some forty checks and takes five to ten seconds; when the page waited for it
 * the whole tab sat on the admin spinner that long, including the probe
 * history and the schedule, which are a database read and one small file.
 */
export default function AdminHealthPage() {
  unstable_noStore();

  // Read once, shown twice: the probe panel and the schedule both use it.
  const probeRuns = getHealthProbeHistory().catch(() => []);

  return (
      <div className="space-y-10">
      <AdminSection title="Services" className="space-y-6">
        <Suspense fallback={<PanelWaiting label="Checking every service…" />}>
          <Services />
        </Suspense>
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
          <Suspense fallback={<PanelWaiting label="Reading past checks…" />}>
            <PlaybackChecks />
          </Suspense>
        </div>
        {/* Also Services, for the same reason: these probe every
            dependency the stack has (Sonarr, Radarr, indexers, the
            published status files), so they answer "is anything broken"
            one section down from the services list itself. */}
        <div className="border-t border-white/10 pt-5">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/30">
            Dependency probes
          </h3>
          <Suspense fallback={<PanelWaiting label="Reading past probes…" />}>
            <Probes runs={probeRuns} />
          </Suspense>
        </div>
      </AdminSection>

      <AdminSection title="Scheduled">
        <Suspense fallback={<PanelWaiting label="Reading the schedule…" />}>
          <Scheduled runs={probeRuns} />
        </Suspense>
      </AdminSection>
      </div>
  );
}

type ProbeRuns = ReturnType<typeof getHealthProbeHistory>;

async function Services() {
  return <ServicesPanel services={await getServiceStatuses().catch(() => [])} />;
}

async function PlaybackChecks() {
  return <PlaybackCheckPanel runs={await getPlaybackCheckHistory().catch(() => [])} />;
}

async function Probes({ runs }: { runs: ProbeRuns }) {
  const healthProbeRuns = await runs;
  return (
    <HealthProbePanel
      runs={healthProbeRuns.map((run) => ({
        ...run,
        // Date -> string at the server/client boundary, matching the
        // playback panel next door.
        ranAt: run.ranAt.toISOString(),
      }))}
    />
  );
}

async function Scheduled({ runs }: { runs: ProbeRuns }) {
  const [healthProbeRuns, cronInventory] = await Promise.all([
    runs,
    // Null when unreachable, which the panel shows differently from an empty
    // schedule -- "we could not ask" is not "nothing is scheduled".
    fetchCronInventory(),
  ]);
  return (
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
        health: jobHealth(job, new Date(), cronInventory?.generatedAt),
      }))}
    />
  );
}
