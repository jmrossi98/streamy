"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AWS_SPEND_PROBLEMS,
  describeCost,
  formatUsd,
  type AwsSpend,
  type SpendTotals,
} from "@/lib/spendRules";

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
};

type Props = {
  rows: SpendRow[];
  totals: SpendTotals;
  aws: AwsSpend;
  openRouter: { used: number; limit: number | null } | null;
};

const CADENCES = ["monthly", "yearly", "metered", "free"];

const INPUT_CLASS =
  "rounded border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/40 focus:outline-none";

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
 */
export function SpendPanel({ rows, totals, aws, openRouter }: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          renewsAt: form.get("renewsAt"),
          category: form.get("category"),
          cost: Number(form.get("cost")),
          cadence: form.get("cadence"),
          url: form.get("url"),
          notes: form.get("notes"),
        }),
      });
      if (res.ok) {
        setAdding(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function setRenewal(row: SpendRow, value: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // No `active` sent: the handler only writes the fields it's given,
        // so clearing a date can't accidentally revive a cancelled row.
        body: JSON.stringify({ id: row.id, renewsAt: value }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: SpendRow) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, active: !row.active }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = rows.filter((r) => r.active);
  const cancelled = rows.filter((r) => !r.active);

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
      </div>

      <div className="rounded-lg border border-white/10 bg-netflix-dark/60">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <h4 className="text-sm font-semibold text-white">Subscriptions</h4>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
          >
            {adding ? "Cancel" : "Add"}
          </button>
        </div>

        {adding && (
          <form onSubmit={add} className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-2">
            <input name="name" required placeholder="Name" className={INPUT_CLASS} />
            <input name="category" placeholder="Category (Usenet, AI, VPN)" className={INPUT_CLASS} />
            <input
              name="cost"
              type="number"
              step="0.01"
              min="0"
              placeholder="Cost (0 for metered or free)"
              className={INPUT_CLASS}
            />
            <select name="cadence" defaultValue="monthly" className={INPUT_CLASS}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              name="url"
              placeholder="Where it is managed (URL)"
              className={INPUT_CLASS + " sm:col-span-2"}
            />
            <label className="flex flex-col gap-1 text-xs text-white/40 sm:col-span-2">
              Renews on (leave blank for anything that reports its own date)
              <input name="renewsAt" type="date" className={INPUT_CLASS} />
            </label>
            <input name="notes" placeholder="Notes" className={INPUT_CLASS + " sm:col-span-2"} />
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-netflix-red px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 sm:col-span-2"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-white/40">
            Nothing listed yet. Add what you pay for - nothing can discover it
            automatically, which is rather the point.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {[...active, ...cancelled].map((row) => (
              <li
                key={row.id}
                className={
                  "flex items-start gap-3 px-4 py-3 " + (row.active ? "" : "opacity-40")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-white">{row.name}</span>
                    {row.category && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/50">
                        {row.category}
                      </span>
                    )}
                    {!row.active && <span className="text-[11px] text-white/40">cancelled</span>}
                  </div>
                  {row.notes && <p className="truncate text-xs text-white/40">{row.notes}</p>}
                  {row.url && (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-xs text-white/40 underline hover:text-white/70"
                    >
                      manage
                    </a>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm tabular-nums text-white/80">
                    {describeCost(row.cost, row.cadence)}
                  </p>
                  {row.cadence === "metered" && (
                    <p className="text-xs tabular-nums text-white/40">
                      {typeof row.actual === "number"
                        ? formatUsd(row.actual) + " MTD"
                        : "no data"}
                    </p>
                  )}
                </div>
                {/* Editable in place: a renewal date is the one field on a
                    row that goes stale by itself, so correcting it shouldn't
                    mean re-entering the subscription. */}
                <input
                  type="date"
                  value={row.renewsAt?.slice(0, 10) ?? ""}
                  onChange={(e) => setRenewal(row, e.target.value)}
                  disabled={busy}
                  title="Renews on"
                  className="shrink-0 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/60 disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={busy}
                  title={row.active ? "Mark cancelled" : "Mark active"}
                  className="shrink-0 rounded bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-white/15 disabled:opacity-40"
                >
                  {row.active ? "Cancel" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
