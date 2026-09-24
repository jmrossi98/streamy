import type { VisitorSummary } from "@/lib/siteVisits";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-xs text-white/40">{label}</p>
    </div>
  );
}

// This panel renders server-side, so a bare toLocaleString() used whatever
// timezone the server process is in (UTC on the Lightsail box) -- not the
// viewer's, and not necessarily meaningful to anyone. Pinned to New York
// explicitly instead, since that's the one timezone every viewer of this
// panel actually cares about, regardless of where the render happens to run
// or where the viewer themselves is.
const VISITOR_LOG_TIME_ZONE = "America/New_York";
const visitorLogTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: VISITOR_LOG_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "medium",
});

function formatVisitAt(at: string): string {
  return `${visitorLogTimeFormatter.format(new Date(at))} ET`;
}

type VisitorRow = VisitorSummary["recent"][number];

/**
 * Badge colours, kept in step with the map's own legend in VisitorMapPanel:
 * purple for Jellyfin, orange for assistant turns. Two sign-in streams now
 * share this log -- this app's and Jellyfin's -- so they are coloured apart
 * rather than both reading as "a sign-in".
 *
 * Extracted from a nested ternary that was readable at two kinds and stopped
 * being so at four.
 */
function badgeClass(v: VisitorRow): string {
  switch (v.kind) {
    case "login":
      return v.success
        ? "bg-green-500/15 text-green-300"
        : "bg-amber-500/15 text-amber-300";
    case "jellyfin":
      return v.success
        ? "bg-purple-500/15 text-purple-300"
        : "bg-purple-500/25 text-purple-200";
    case "assistant":
      return "bg-orange-500/15 text-orange-300";
    default:
      return v.site === "streamy"
        ? "bg-red-500/15 text-red-300"
        : "bg-sky-500/15 text-sky-300";
  }
}

function badgeLabel(v: VisitorRow): string {
  switch (v.kind) {
    case "login":
      return v.success ? "sign-in" : "sign-in ✗";
    case "jellyfin":
      return v.success ? "jellyfin" : "jellyfin ✗";
    case "assistant":
      return "assistant";
    default:
      return v.site;
  }
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
  const { visits24h, visits7d, uniqueVisitors7d, topPages, topReferrers, recent, totalActivity } =
    summary;

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
            {topPages.length === 0 && <li className="text-sm text-white/40">-</li>}
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
            {topReferrers.length === 0 && <li className="text-sm text-white/40">-</li>}
          </ul>
        </div>
      </div>

      <div>
        <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-white/30">
          <span>Visitor log</span>
          <span className="normal-case text-white/40">
            {recent.length}
            {totalActivity > recent.length ? ` of ${totalActivity}` : ""} events
          </span>
        </h3>
        {/* Scrolls inside its own container so a wide row never makes the page
            scroll sideways on mobile, and a long log doesn't push the page down. */}
        <div className="max-h-[32rem] overflow-y-auto rounded border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-netflix-dark text-xs uppercase tracking-wide text-white/30">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Page</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">From</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((v) => (
                  <tr key={v.id} className="border-t border-white/5">
                    <td className="whitespace-nowrap px-3 py-2 text-white/50">{formatVisitAt(v.at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${badgeClass(v)}`}>
                        {badgeLabel(v)}
                      </span>
                    </td>
                    {/* Assistant rows are the one kind allowed to grow.
                        A prompt is the content -- truncated to twelve
                        characters of "why is the download stuck" it tells you
                        nothing, and hovering for a title attribute does not
                        work on the phone this panel is mostly read on. Every
                        other row stays on one line so the table keeps its
                        shape. */}
                    {v.kind === "assistant" ? (
                      <td className="max-w-[28rem] whitespace-pre-wrap break-words px-3 py-2 align-top text-white/80">
                        {v.path}
                      </td>
                    ) : (
                      <td className="max-w-[12rem] truncate px-3 py-2 text-white/80" title={v.path}>
                        {v.path}
                      </td>
                    )}
                    <td className="max-w-[10rem] truncate px-3 py-2 text-white/60">
                      {v.location ?? <span className="text-white/25">-</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-white/60">
                      {/* A row whose source had no readable address gets a
                          dash, not a blank cell. */}
                      {v.ip || <span className="text-white/25">-</span>}
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
        Beacon-based, so only clients that run JavaScript appear here - bots and scanners
        do not.
      </p>
    </div>
  );
}
