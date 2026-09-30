import { AdminSection } from "@/components/ui";
import { PageWatchPanel } from "@/components/PageWatchPanel";
import { getPageWatchSummary } from "@/lib/pageWatch";

export default async function AdminTourWatchPage() {
  // Deliberately unguarded: a fallback would have to invent egressEnabled and
  // egressProxied, and rendering "egress disabled" when the truth is "we could
  // not read it" is worse than the panel being absent.
  const pageWatch = await getPageWatchSummary();

  return (
      <div className="space-y-10">
      <AdminSection title="Tour watch">
        <PageWatchPanel summary={pageWatch} />
      </AdminSection>
      </div>
  );
}
