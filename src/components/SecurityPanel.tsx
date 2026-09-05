import type { Finding, LoginActivity, Severity } from "@/lib/securityRules";
import { overallSeverity } from "@/lib/securityRules";
import type { AuditLogRow } from "@/lib/auditLog";

type Props = {
  activity: LoginActivity;
  findings: Finding[];
  generatedAt: string;
  auditLog: AuditLogRow[];
};

// "movie.request" -> "Requested"; "game.artwork.save" -> "Saved artwork";
// falls back to the raw action for anything not in this list rather than
// hiding it, since a genuinely new action type is exactly what an admin
// reading an audit log should still be able to see, just less prettily.
const ACTION_LABELS: Record<string, string> = {
  "movie.request": "Requested",
  "movie.request.retry": "Searched again",
  "movie.cancel": "Cancelled",
  "movie.delete": "Deleted",
  "movie.admin.cancel": "Cancelled (admin)",
  "movie.admin.delete": "Deleted (admin)",
  "show.request": "Requested",
  "show.request.retry": "Searched again",
  "show.cancel": "Cancelled",
  "show.delete": "Deleted",
  "show.admin.cancel": "Cancelled (admin)",
  "show.admin.delete": "Deleted (admin)",
  "game.queue": "Queued",
  "game.queue.remove": "Removed from queue",
  "game.download.retry": "Retried download",
  "game.artwork.save": "Saved artwork",
  "game.artwork.clear": "Cleared artwork",
  "game.download.cancel": "Cancelled download",
  "game.title.save": "Edited title",
  "game.title.clear": "Cleared title override",
  "approval.approve": "Approved user",
  "approval.deny": "Denied user",
};

// Status colour is paired with a text label everywhere it appears, so severity
// is never carried by colour alone.
const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; label: string }> = {
  critical: { dot: "bg-red-500", text: "text-red-400", label: "Critical" },
  warning: { dot: "bg-amber-400", text: "text-amber-400", label: "Warning" },
  info: { dot: "bg-emerald-500", text: "text-emerald-400", label: "OK" },
};

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold ${muted ? "text-white/40" : "text-white"}`}>
        {value}
      </p>
      <p className="text-xs text-white/40">{label}</p>
    </div>
  );
}

export function SecurityPanel({ activity, findings, generatedAt, auditLog }: Props) {
  // Actionable findings first; the informational ones are reassurance, not news.
  const actionable = findings.filter((f) => f.severity !== "info");
  const healthy = findings.filter((f) => f.severity === "info");
  const overall = SEVERITY_STYLE[overallSeverity(findings)];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${overall.dot}`} aria-hidden />
          <span className={`text-sm font-medium ${overall.text}`}>
            {actionable.length === 0 ? "No issues detected" : `${actionable.length} to review`}
          </span>
        </div>
        <span className="text-xs text-white/30">
          {new Date(generatedAt).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Sign-ins (24h)" value={activity.successesLast24h} muted />
        <Stat label="Failed (24h)" value={activity.failuresLast24h} />
        <Stat label="Source IPs" value={activity.distinctFailedIps} />
        <Stat label="Blocked" value={activity.lockedOutAttempts} />
      </div>

      {activity.topIp && (
        <p className="text-xs text-white/40">
          Most failures from{" "}
          <span className="font-mono text-white/60">{activity.topIp.ip}</span> (
          {activity.topIp.failures})
        </p>
      )}

      <div className="space-y-2">
        {actionable.map((f) => {
          const s = SEVERITY_STYLE[f.severity];
          return (
            <div
              key={f.id}
              className="rounded border border-white/10 bg-black/30 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                <span className={`text-xs font-medium uppercase tracking-wide ${s.text}`}>
                  {s.label}
                </span>
                <span className="text-sm font-medium text-white">{f.title}</span>
              </div>
              <p className="mt-1 pl-4 text-sm text-white/60">{f.detail}</p>
            </div>
          );
        })}

        {actionable.length === 0 && (
          <p className="text-sm text-white/50">
            Nothing anomalous in the last 24 hours.
          </p>
        )}
      </div>

      {healthy.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-white/40 hover:text-white/70">
            {healthy.length} passing check{healthy.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {healthy.map((f) => (
              <li key={f.id} className="flex gap-2 text-xs text-white/50">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/60" aria-hidden />
                <span>
                  <span className="text-white/70">{f.title}</span> — {f.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="border-t border-white/10 pt-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/30">
          Recent admin activity
        </h3>
        {auditLog.length === 0 ? (
          <p className="text-sm text-white/50">Nothing recorded yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {auditLog.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-white/70">{e.actorName}</span>
                <span className="shrink-0 text-white/40">
                  {ACTION_LABELS[e.action] ?? e.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-white/90">{e.target}</span>
                {e.detail && (
                  <span className="shrink-0 text-xs text-white/30">{e.detail}</span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-white/30">
                  {new Date(e.createdAt).toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
