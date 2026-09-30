import { unstable_noStore } from "next/cache";
import { AdminSection } from "@/components/ui";
import { runSecurityChecks } from "@/lib/securityChecks";
import { SecurityPanel } from "@/components/SecurityPanel";
import { VisitorsPanel } from "@/components/VisitorsPanel";
import { getVisitorSummary } from "@/lib/siteVisits";
import { VisitorMapPanel } from "@/components/VisitorMapPanel";
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
      <AdminSection title="Security">
        <SecurityPanel
          activity={security.activity}
          findings={security.findings}
          generatedAt={security.generatedAt}
          auditLog={auditLog}
        />
      </AdminSection>

      <AdminSection title="Visitors">
        <VisitorsPanel summary={visitors} />
      </AdminSection>

      <AdminSection title="Visitor map">
        <VisitorMapPanel />
      </AdminSection>
      </div>
  );
}
