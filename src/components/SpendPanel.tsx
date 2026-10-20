"use client";

import { ServiceList } from "@/components/ServiceList";
import {
  AWS_SPEND_PROBLEMS,
  formatUsd,
  type AwsSpend,
  type SpendTotals,
} from "@/lib/spendRules";
// Type-only: renewals.ts opens a TLS socket and must not reach the browser.
import type { Renewal } from "@/lib/renewals";
import type { AnthropicMonthSpend } from "@/lib/anthropicRules";

export type SpendRow = {
  id: string;
  name: string;
  category: string;
  cost: number;
  cadence: string;
  url: string;
  notes: string;
  active: boolean;
  /** Month-to-date, for the metered ones that can report it. */
  actual?: number | null;
  /** ISO date, for the ones nothing can be asked automatically. */
  renewsAt?: string | null;
  /** Whole days until renewsAt; null when no date is set. */
  daysLeft?: number | null;
};

type Props = {
  rows: SpendRow[];
  totals: SpendTotals;
  aws: AwsSpend;
  openRouter: { used: number; limit: number | null } | null;
  /** Estimated from per-response usage; null when the provider is off. */
  anthropic: AnthropicMonthSpend | null;
  /** The probed expiries -- IPTV, the cert, the domain. Read-only. */
  autoRenewals: Renewal[];
};

/**
 * What every paid service costs, and what that adds up to.
 *
 * Replaces the AWS-spend health check, which answered a different question: it
 * compared month-to-date against a ceiling and reported pass/fail. A threshold
 * tells you when something is wrong; it never tells you what you are paying,
 * and the second is what was wanted.
 *
 * The list is hand-maintained because nothing can discover it. There is no API
 * for "what has this person signed up for" -- which is exactly why the panel
 * is needed at all.
 *
 * Renewals used to be a panel of their own directly above this one, which
 * meant a subscription with a date on it was printed twice: once as "in 24d"
 * up there and once as "$12/mo" down here, with an editable date field that
 * silently drove the other list. Cost and expiry are two facts about one
 * thing, so they now share a row. The three probed expiries (IPTV, the cert,
 * the domain) have no price and nothing to edit, so they sit underneath in
 * the same list rather than in a separate card.
 */
/** 1234567 -> "1.2M", 45000 -> "45k". Token counts, where the order of magnitude is the point. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function SpendPanel({ rows, totals, aws, openRouter, anthropic, autoRenewals }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-netflix-dark/80 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Monthly total</p>
            <p className="font-display text-3xl font-bold text-white">
              {formatUsd(totals.totalMonthly)}
            </p>
          </div>
          <div className="text-right text-xs text-white/50">
            <p>{formatUsd(totals.fixedMonthly)} fixed</p>
            <p>{formatUsd(totals.meteredMonthly)} metered, month to date</p>
          </div>
        </div>

        {totals.unknownMetered.length > 0 && (
          // Said out loud rather than folded in as zero: a total that quietly
          // omits something is worse than one that admits what it is missing.
          <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
            Not included - no live figure for {totals.unknownMetered.join(", ")}. The
            real total is higher.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Always rendered, even with no figure. An empty section read as
            "AWS costs nothing"; the failure it was actually hiding was a
            credential without the Cost Explorer permission. */}
        <div className="rounded-lg border border-white/10 bg-black/30 p-4">
          <h4 className="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold text-white">
            <span>AWS, month to date</span>
            {aws.ok && (
              <span className="tabular-nums text-white/80">{formatUsd(aws.monthToDate)}</span>
            )}
          </h4>
          {!aws.ok ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
              <p>{AWS_SPEND_PROBLEMS[aws.reason]}</p>
              {aws.detail !== AWS_SPEND_PROBLEMS[aws.reason] && (
                <p className="mt-1 text-amber-200/60">{aws.detail}</p>
              )}
            </div>
          ) : aws.byService.length === 0 ? (
            <p className="text-sm text-white/40">Nothing billed yet this month.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {aws.byService.map((r) => (
                <li key={r.service} className="flex justify-between gap-3">
                  <span className="truncate text-white/60">{r.service}</span>
                  <span className="shrink-0 tabular-nums text-white/80">
                    {formatUsd(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {openRouter && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h4 className="mb-2 text-sm font-semibold text-white">OpenRouter</h4>
            <p className="text-sm text-white/70">
              {formatUsd(openRouter.used)} used
              {openRouter.limit !== null ? ` of ${formatUsd(openRouter.limit)}` : ""}
            </p>
            {openRouter.limit === null && (
              <p className="mt-1 text-xs text-white/40">No spend limit set on this key.</p>
            )}
          </div>
        )}

        {anthropic && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-4">
            <h4 className="mb-2 text-sm font-semibold text-white">Anthropic</h4>
            <p className="text-sm text-white/70">
              ~{formatUsd(anthropic.usd)} this month
              <span className="text-white/40"> · {anthropic.calls} call{anthropic.calls === 1 ? "" : "s"}</span>
            </p>
            <p className="mt-1 text-xs text-white/40">
              {/* Estimated locally from each response's token counts at list
                  price: a plain API key cannot ask the account what is left
                  of its prepaid credit. The Console has the exact figure. */}
              Estimated from {formatTokens(anthropic.inputTokens + anthropic.cacheReadTokens + anthropic.cacheWriteTokens)} in /{" "}
              {formatTokens(anthropic.outputTokens)} out at list price
              {anthropic.unpricedCalls > 0 ? `; ${anthropic.unpricedCalls} on an unpriced model not counted` : ""}.
            </p>
          </div>
        )}
      </div>

      <ServiceList rows={rows} autoRenewals={autoRenewals} />
    </div>
  );
}
