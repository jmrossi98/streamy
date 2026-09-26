import { unstable_noStore } from "next/cache";
import { runSecurityChecks } from "@/lib/securityChecks";
import { SecurityPanel } from "@/components/SecurityPanel";
import { VisitorsPanel } from "@/components/VisitorsPanel";
import { getVisitorSummary } from "@/lib/siteVisits";
import { VisitorMapPanel } from "@/components/VisitorMapPanel";
import { PanelBoundary } from "@/components/PanelBoundary";
import { getRecentAuditLog } from "@/lib/auditLog";

/**
 * Who has been here, and whether anything about it looks wrong.
 *
 * The visitor log and map sit with the security checks rather than on their own
 * tab because they answer the same question -- an unexpected sign-in and an
 * unexpected country are the same evidence from two angles.
 */
export default async function AdminSecurityPage() {
  unstable_noStore();

  const [security, auditLog, visitors] = await Promise.all([
    runSecurityChecks(),
    getRecentAuditLog().catch(() => []),
    getVisitorSummary("portfolio"),
  ]);

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
      </div>
  );
}
