import { PanelBoundary } from "@/components/PanelBoundary";
import { PageWatchPanel } from "@/components/PageWatchPanel";
import { getPageWatchSummary } from "@/lib/pageWatch";

export default async function AdminTourWatchPage() {
  // Deliberately unguarded: a fallback would have to invent egressEnabled and
  // egressProxied, and rendering "egress disabled" when the truth is "we could
  // not read it" is worse than the panel being absent.
  const pageWatch = await getPageWatchSummary();

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Tour watch</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Tour watch">
            <PageWatchPanel summary={pageWatch} />
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
