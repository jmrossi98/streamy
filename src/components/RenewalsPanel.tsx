import type { Renewal } from "@/lib/renewals";

/**
 * What expires next, across everything.
 *
 * Deliberately one list rather than a column per service. The question being
 * asked is "is anything about to lapse", and answering it used to mean
 * remembering which four places to go and look -- an IPTV panel, the cert,
 * the registrar, and a note somewhere about the usenet block.
 *
 * Server component: every row arrives resolved, and nothing here needs to
 * change without a reload.
 */
export function RenewalsPanel({ renewals }: { renewals: Renewal[] }) {
  if (renewals.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-netflix-dark/60">
      <div className="flex items-baseline justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h4 className="text-sm font-semibold text-white">Renewals</h4>
        <p className="text-xs text-white/40">Soonest first</p>
      </div>
      <ul className="divide-y divide-white/5">
        {renewals.map((r) => (
          <li key={`${r.source}:${r.name}`} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white/90">{r.name}</p>
              {(r.detail || r.problem) && (
                <p
                  className={`truncate text-xs ${r.problem ? "text-amber-200/70" : "text-white/40"}`}
                >
                  {r.problem || r.detail}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-sm tabular-nums ${urgencyClass(r.daysLeft)}`}>
                {describeDue(r)}
              </p>
              {r.expiresUtc && (
                <p className="text-xs tabular-nums text-white/35">
                  {new Date(r.expiresUtc).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Days, not a date, as the headline.
 *
 * A date makes you do the subtraction; "in 24 days" is the form the question
 * was actually asked in. The date stays underneath for anyone booking it in.
 */
function describeDue(r: Renewal): string {
  if (r.problem) return "unknown";
  if (r.daysLeft === null) return "no expiry";
  if (r.daysLeft < 0) return `${Math.abs(r.daysLeft)}d overdue`;
  if (r.daysLeft === 0) return "today";
  if (r.daysLeft === 1) return "tomorrow";
  return `in ${r.daysLeft}d`;
}

function urgencyClass(daysLeft: number | null): string {
  if (daysLeft === null) return "text-white/50";
  if (daysLeft < 0) return "font-semibold text-red-300";
  if (daysLeft <= 7) return "font-semibold text-amber-300";
  if (daysLeft <= 21) return "text-amber-200/80";
  return "text-white/70";
}
