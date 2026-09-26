import { Suspense } from "react";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { PanelBoundary } from "@/components/PanelBoundary";

/**
 * Throughput and connection history over the tailnet.
 *
 * Its own tab now. It reads a 24-hour history and is the slowest panel here, so
 * sharing a page meant everything else waited on a chart nobody had asked for.
 */
export default function AdminMetricsPage() {
  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Metrics</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Metrics">
            <Suspense fallback={<p className="py-8 text-center text-sm text-white/30">Loading metrics…</p>}>
              <ConnectionsPanel />
            </Suspense>
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
