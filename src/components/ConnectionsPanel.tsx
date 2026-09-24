import {
  getMetricsHistory,
  deriveThroughput,
  deriveTemps,
  derivePower,
  diskNames,
  diskLabel,
  isMetricsHistoryConfigured,
} from "@/lib/metricsHistory";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";

/**
 * Throughput and component temperatures over the last 24 hours.
 *
 * Two charts rather than one with two y-axes. Bytes per second and degrees
 * Celsius share no scale, and a dual-axis chart lets whoever picked the two
 * ranges decide which line looks like it is "above" the other -- the single
 * most common way a chart lies.
 */
export async function ConnectionsPanel() {
  if (!isMetricsHistoryConfigured()) {
    return (
      <p className="text-sm text-white/40">
        Not configured - set <code className="text-white/60">FLASH_LIBRARY_URL</code>.
      </p>
    );
  }

  const history = await getMetricsHistory();
  if (!history) {
    return (
      <p className="text-sm text-white/40">
        Couldn&apos;t read the metrics history - is metrics-sample.sh running on mediabox?
      </p>
    );
  }

  const throughput = deriveThroughput(history);
  const temps = deriveTemps(history);
  const power = derivePower(history);
  const disks = diskNames(temps);
  // Kinds come from the newest sample that has them -- an older history
  // written before the sampler recorded them simply falls back to device
  // names rather than mislabelling anything.
  const kinds = temps.at(-1)?.diskKinds ?? {};

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Throughput (24h)</h3>
          <p className="text-xs text-white/35">
            Averaged over each 5-minute sample. Gaps are intervals we have no reading for.
          </p>
        </div>
        <TimeSeriesChart
          times={throughput.map((p) => p.t)}
          unit="bytesPerSecond"
          series={[
            { label: "Down", values: throughput.map((p) => p.primaryDown) },
            { label: "Up", values: throughput.map((p) => p.primaryUp) },
            { label: "Tailnet down", values: throughput.map((p) => p.tailscaleDown) },
            { label: "Tailnet up", values: throughput.map((p) => p.tailscaleUp) },
          ]}
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Temperatures (24h)</h3>
          <p className="text-xs text-white/35">
            Ambient is the board sensor - it is what separates a hot drive from a hot case.
          </p>
        </div>
        <TimeSeriesChart
          times={temps.map((p) => p.t)}
          unit="celsius"
          zeroBased={false}
          series={[
            { label: "CPU", values: temps.map((p) => p.cpu) },
            { label: "GPU", values: temps.map((p) => p.gpu) },
            ...disks.map((d) => ({
              label: diskLabel(d, kinds, disks),
              values: temps.map((p) => p.disks[d] ?? null),
            })),
            { label: "Ambient", values: temps.map((p) => p.ambient) },
          ]}
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Power (24h)</h3>
          <p className="text-xs text-white/35">
            CPU package and memory only - nothing on this box reports a whole-system figure, so
            the real draw at the wall is higher than this.
          </p>
        </div>
        <TimeSeriesChart
          times={power.map((p) => p.t)}
          unit="watts"
          series={[
            { label: "CPU package", values: power.map((p) => p.cpuWatts) },
            { label: "Memory", values: power.map((p) => p.dramWatts) },
          ]}
        />
      </section>
    </div>
  );
}
