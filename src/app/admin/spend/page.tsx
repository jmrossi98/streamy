import { prisma } from "@/lib/db";
import { SpendPanel } from "@/components/SpendPanel";
import { computeTotals, daysUntil } from "@/lib/spendRules";
import { awsSpend, openRouterCredits } from "@/lib/spend";
import { getAutomaticRenewals } from "@/lib/renewals";
import { PanelBoundary } from "@/components/PanelBoundary";

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

  const spendTotals = computeTotals(subscriptions, meteredActuals);
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
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Spend</h2>
        <div className="bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-5 sm:px-6">
          <PanelBoundary name="Spend">
            <div className="space-y-4">
              <SpendPanel
                rows={spendRows}
                totals={spendTotals}
                aws={aws}
                openRouter={openRouter}
                autoRenewals={autoRenewals}
              />
            </div>
          </PanelBoundary>
        </div>
      </section>
      </div>
  );
}
