import { Suspense } from "react";
import { AdminSection } from "@/components/ui";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";

/**
 * Throughput and connection history over the tailnet.
 *
 * Its own tab now. It reads a 24-hour history and is the slowest panel here, so
 * sharing a page meant everything else waited on a chart nobody had asked for.
 */
export default function AdminMetricsPage() {
  return (
      <div className="space-y-10">
      <AdminSection title="Metrics">
        <Suspense fallback={<p className="py-8 text-center text-sm text-white/30">Loading metrics…</p>}>
          <ConnectionsPanel />
        </Suspense>
      </AdminSection>
      </div>
  );
}
