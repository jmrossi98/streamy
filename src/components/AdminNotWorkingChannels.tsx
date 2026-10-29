"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NotWorkingRow } from "@/lib/liveChannelHealth";
import { Badge, Button, scrollListClass } from "@/components/ui";

/** "3 hours ago", "2 days ago". */
function ago(at: number | null, now: number): string {
  if (at == null) return "";
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "in 5 hours" for a retry still ahead. */
function until(at: number | null, now: number): string {
  if (at == null || at <= now) return "";
  const hours = Math.max(1, Math.round((at - now) / 3_600_000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Channels taken out of the lineup for not working, and the ones back on
 * trial (liveChannelStateRules.ts). Viewers never see the hidden ones in the
 * rows or the guide; this is where an admin sees what was hidden, why, and
 * can put one back by hand -- after fixing a provider, say -- without waiting
 * out the day's cool-off.
 */
export function AdminNotWorkingChannels({ rows, generatedAt }: { rows: NotWorkingRow[]; generatedAt: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  async function putBack(name: string) {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch("/api/admin/live-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      setCleared((s) => new Set(s).add(name));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const visible = rows.filter((r) => !cleared.has(r.name));
  if (visible.length === 0) {
    return (
      <p className="text-sm text-white/40">
        Every channel is being offered. One is hidden here after two separate tunes that never reached a picture.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/45">
        Hidden from the Live TV rows, the guide and game picks (still greyed in people&rsquo;s My Stations). Each comes
        back by itself after a day as &ldquo;Retrying&rdquo;, as soon as anyone gets a picture from it, or when
        mediabox&rsquo;s channel check opens it. &ldquo;Slow for viewers&rdquo; channels are still offered, just not
        as a game&rsquo;s default over a smooth one, for up to 3 hours (1 hour on one viewer&rsquo;s word alone).
      </p>
      <ul className={scrollListClass({}, "space-y-2")}>
        {visible.map((r) => (
          <li key={r.name} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium text-white/85">{r.name}</span>
                {r.state === "slow" ? (
                  <Badge tone="warning">Slow for viewers</Badge>
                ) : r.state === "retrying" ? (
                  <Badge tone="warning">Retrying</Badge>
                ) : (
                  <Badge tone="danger">Hidden</Badge>
                )}
              </div>
              <p className="truncate text-xs text-white/45" title={r.lastError ?? undefined}>
                {r.source === "viewers"
                  ? `Kept buffering for ${r.people.join(", ")}${r.corroborated ? "" : " (one viewer, may be their connection)"}, last ${ago(r.lastFailureAt, generatedAt)} · ranked below smooth channels, stops counting ${until(r.retryAt, generatedAt) || "soon"}`
                  : r.source === "checker"
                  ? `mediabox's channel check could not open it, down since ${ago(r.lastFailureAt, generatedAt)}`
                  : `${r.failedTunes} failed tune${r.failedTunes === 1 ? "" : "s"} (${r.people.join(", ")}), last ${ago(r.lastFailureAt, generatedAt)}`}
                {r.source === "tunes" && r.state === "not-working" && r.retryAt != null && ` · offered again ${until(r.retryAt, generatedAt)}`}
                {r.lastError && ` · ${r.lastError}`}
              </p>
            </div>
            {r.source === "tunes" ? (
              <Button size="sm" onClick={() => putBack(r.name)} disabled={busy === r.name}>
                {busy === r.name ? "…" : "Put back"}
              </Button>
            ) : r.source === "viewers" ? (
              <span className="text-xs text-white/35">Clears when it plays smoothly</span>
            ) : (
              <span className="text-xs text-white/35">Returns when the check opens it</span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
