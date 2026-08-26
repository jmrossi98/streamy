import type { VisitorSummary } from "@/lib/siteVisits";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-xs text-white/40">{label}</p>
    </div>
  );
}

function hostOf(referrer: string): string {
  if (referrer === "(direct)") return referrer;
  try {
    return new URL(referrer).host;
  } catch {
    return referrer;
  }
}

export function VisitorsPanel({ summary }: { summary: VisitorSummary }) {
  const { visits24h, visits7d, uniqueVisitors7d, topPages, topReferrers, recent } = summary;

  if (visits7d === 0 && recent.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No visits recorded yet. The beacon needs to be added to the portfolio site before
        anything appears here.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Visits (24h)" value={visits24h} />
        <Stat label="Visits (7d)" value={visits7d} />
        <Stat label="Unique (7d)" value={uniqueVisitors7d} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
            Top pages
          </h3>
          <ul className="space-y-1">
            {topPages.map((p) => (
              <li key={p.path} className="flex justify-between gap-3 text-sm">
                <span className="truncate text-white/70">{p.path}</span>
                <span className="shrink-0 text-white/40">{p.count}</span>
              </li>
            ))}
            {topPages.length === 0 && <li className="text-sm text-white/40">—</li>}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
            Top referrers
          </h3>
          <ul className="space-y-1">
            {topReferrers.map((r) => (
              <li key={r.referrer} className="flex justify-between gap-3 text-sm">
                <span className="truncate text-white/70">{hostOf(r.referrer)}</span>
                <span className="shrink-0 text-white/40">{r.count}</span>
              </li>
            ))}
            {topReferrers.length === 0 && <li className="text-sm text-white/40">—</li>}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/30">
          Recent visits
        </h3>
        {/* Scrolls inside its own container so a wide row never makes the page
            scroll sideways on mobile. */}
        <div className="max-h-72 overflow-y-auto rounded border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-netflix-dark text-xs uppercase tracking-wide text-white/30">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Page</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">From</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((v) => (
                  <tr key={v.id} className="border-t border-white/5">
                    <td className="whitespace-nowrap px-3 py-2 text-white/50">
                      {new Date(v.at).toLocaleString()}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-white/80">{v.path}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-white/60">
                      {v.ip}
                      {v.country ? <span className="ml-1 text-white/30">{v.country}</span> : null}
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 text-white/50">
                      {v.referrer ? hostOf(v.referrer) : "direct"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-xs text-white/30">
        Beacon-based, so only clients that run JavaScript appear here — bots and scanners
        do not.
      </p>
    </div>
  );
}
