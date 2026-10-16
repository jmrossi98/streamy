import { prisma } from "@/lib/db";
import { AdminSection } from "@/components/ui";
import { SpendPanel } from "@/components/SpendPanel";
import { computeTotals, daysUntil } from "@/lib/spendRules";
import { awsSpend, openRouterCredits } from "@/lib/spend";
import { getAutomaticRenewals } from "@/lib/renewals";

export default async function AdminSpendPage() {
  const [subscriptions, aws, openRouter, autoRenewals] = await Promise.all([
    prisma.subscription.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    // Both swallow their own failures and answer null, so an expired AWS
    // credential or an unreachable OpenRouter costs those figures and not the
    // page. The panel then names what it could not read.
    awsSpend(),
    openRouterCredits(),
    // Cert, domain and IPTV expiry. Each answers for itself.
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

  // AWS bills monthly whether or not anyone entered it as a subscription,
  // and the card above always shows its figure -- so the total counts it
  // too. On 2026-10-16 the total read $20.57 (subscriptions only) beside an
  // AWS card it silently left out. An entry named AWS still works as before
  // and is then not counted twice. OpenRouter is not added: its figure is
  // lifetime use of prepaid credit, not this month's bill.
  const hasAwsEntry = subscriptions.some((s) => s.active && s.cadence === "metered" && s.name.toLowerCase().includes("aws"));
  const spendTotals = computeTotals(
    hasAwsEntry || !aws.ok
      ? subscriptions
      : [...subscriptions, { name: "AWS", cost: 0, cadence: "metered", active: true }],
    hasAwsEntry || !aws.ok ? meteredActuals : { ...meteredActuals, AWS: aws.monthToDate }
  );
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
      <AdminSection title="Subscriptions">
        <div className="space-y-4">
          <SpendPanel
            rows={spendRows}
            totals={spendTotals}
            aws={aws}
            openRouter={openRouter}
            autoRenewals={autoRenewals}
          />
        </div>
      </AdminSection>
      </div>
  );
}
