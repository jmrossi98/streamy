"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PageWatchSummary } from "@/lib/pageWatch";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const inputClass =
  "w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-white/30 focus:outline-none";

export function PageWatchPanel({ summary }: { summary: PageWatchSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [togglingEgress, setTogglingEgress] = useState(false);
  const [form, setForm] = useState({
    label: "",
    url: "",
    artist: "",
    selector: "",
    keywords: "",
    ignorePattern: "",
  });

  async function send(body: Record<string, unknown>, method = "POST", query = "") {
    setError(null);
    try {
      const res = await fetch(`/api/admin/page-watch${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        // DELETE takes its id from the query string, so it carries no body.
        ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function addPage(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    // The new page is checked server-side on create to set its baseline, so
    // this can take as long as one fetch.
    const ok = await send({ ...form });
    if (ok) {
      setForm({ label: "", url: "", artist: "", selector: "", keywords: "", ignorePattern: "" });
      setAdding(false);
    }
    setBusy(null);
  }

  async function checkNow(id?: string) {
    setBusy(id ?? "all");
    await send(id ? { action: "check", id } : { action: "check" });
    setBusy(null);
  }

  async function remove(id: string) {
    // No window.confirm: a browser modal blocks the page, and this is
    // recoverable by re-adding the URL.
    setBusy(id);
    await send({}, "DELETE", `?id=${encodeURIComponent(id)}`);
    setBusy(null);
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    await send({ id, enabled }, "PATCH");
    setBusy(null);
  }

  async function toggleEgress(enabled: boolean) {
    setTogglingEgress(true);
    await send({ action: "set-egress", enabled });
    setTogglingEgress(false);
  }

  const { pages, recentChanges, artists, locations, egressEnabled, egressProxied, egressEnforced } =
    summary;

  return (
    <div className="space-y-6">
      {/* Egress state first: it is the one thing here that, if wrong, exposes
          who is doing the watching rather than merely losing a feature. */}
      {/* VPN egress on/off toggle. The live "is it actually protected/leaking"
          check lives in the Services > System health panel now; this is just
          the switch. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/30 px-3 py-2 text-sm">
        <div>
          <span className="text-white/80">VPN egress</span>{" "}
          <span className={egressEnabled ? "text-green-300" : "text-white/40"}>
            {egressEnabled ? "on" : "off"}
          </span>
          <p className="text-xs text-white/40">
            {egressEnabled
              ? egressProxied
                ? `Watch requests route through the VPN${egressEnforced ? " and fail closed if it drops" : ""}. Live status in Services → System.`
                : "On, but no proxy is configured — set PAGE_WATCH_PROXY_URL."
              : "Watch requests go direct, from this server's own IP."}
          </p>
        </div>
        <button
          onClick={() => toggleEgress(!egressEnabled)}
          disabled={togglingEgress}
          role="switch"
          aria-checked={egressEnabled}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            egressEnabled ? "bg-green-500/70" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              egressEnabled ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Watched pages */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-white/30">
            Watched pages ({pages.length})
          </h3>
          <div className="flex gap-3">
            <button
              onClick={() => checkNow()}
              disabled={busy !== null || pages.length === 0}
              className="text-sm text-white/50 transition-colors hover:text-white disabled:opacity-40"
            >
              {busy === "all" ? "Checking…" : "Check all now"}
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              className="text-sm text-white/50 transition-colors hover:text-white"
            >
              {adding ? "Cancel" : "Add page"}
            </button>
          </div>
        </div>

        {adding && (
          <form onSubmit={addPage} className="mb-4 space-y-3 rounded border border-white/10 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputClass}
                placeholder="Name, e.g. Fillmore listings"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                required
              />
              <input
                className={inputClass}
                placeholder="https://example.com/tour"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                required
              />
              <input
                className={inputClass}
                placeholder="Artist (optional, if the page is one artist)"
                value={form.artist}
                onChange={(e) => setForm({ ...form, artist: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Selector: #tour or .listings (optional)"
                value={form.selector}
                onChange={(e) => setForm({ ...form, selector: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Keywords, comma separated (optional)"
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder="Ignore regex, one per line (optional)"
                value={form.ignorePattern}
                onChange={(e) => setForm({ ...form, ignorePattern: e.target.value })}
              />
            </div>
            <p className="text-xs text-white/40">
              A selector narrows the watch to one container, which keeps nav and footer churn out
              of the diff. The first check sets the baseline and never notifies.
            </p>
            <button
              type="submit"
              disabled={busy === "add"}
              className="rounded bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {busy === "add" ? "Adding…" : "Add and check"}
            </button>
          </form>
        )}

        {pages.length === 0 ? (
          <p className="text-sm text-white/50">
            Nothing watched yet. Add a tour page above and it will be checked on the schedule.
          </p>
        ) : (
          <ul className="space-y-2">
            {pages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-white/5 pb-2 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={p.enabled ? "text-sm text-white" : "text-sm text-white/40"}>
                      {p.label}
                    </span>
                    {p.lastStatus === "error" && (
                      <span className="text-xs text-red-400">
                        failing{p.failureCount > 1 ? ` ×${p.failureCount}` : ""}
                      </span>
                    )}
                    {!p.enabled && <span className="text-xs text-white/30">paused</span>}
                  </div>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-white/40 hover:text-white/70"
                  >
                    {p.url}
                  </a>
                  {p.lastError && <p className="text-xs text-red-400/70">{p.lastError}</p>}
                </div>
                <div className="flex shrink-0 items-baseline gap-3 text-xs text-white/40">
                  <span>{p.dateCount} dates</span>
                  <span>{timeAgo(p.lastCheckedAt)}</span>
                  <button
                    onClick={() => checkNow(p.id)}
                    disabled={busy !== null}
                    className="transition-colors hover:text-white disabled:opacity-40"
                  >
                    {busy === p.id ? "…" : "check"}
                  </button>
                  <button
                    onClick={() => toggle(p.id, !p.enabled)}
                    disabled={busy !== null}
                    className="transition-colors hover:text-white disabled:opacity-40"
                  >
                    {p.enabled ? "pause" : "resume"}
                  </button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={busy !== null}
                    className="transition-colors hover:text-red-400 disabled:opacity-40"
                  >
                    remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The overall view: every artist's dates in the watched locations. */}
      <div>
        <h3 className="mb-3 flex flex-wrap items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-white/30">
          <span>All dates ({artists.reduce((n, a) => n + a.dates.length, 0)})</span>
          {locations.length > 0 && (
            <span className="normal-case text-white/40">in {locations.join(" / ")}</span>
          )}
        </h3>
        {artists.length === 0 ? (
          <p className="text-sm text-white/50">
            No dates parsed yet. They appear after the first successful check of a page.
          </p>
        ) : (
          <div className="space-y-4">
            {artists.map((a) => (
              <div key={a.artist}>
                <h4 className="mb-1 text-sm font-medium text-white">{a.artist}</h4>
                <ul className="space-y-0.5">
                  {a.dates.map((d, i) => (
                    <li key={`${d.raw}-${i}`} className="flex gap-3 text-sm">
                      <span className="w-28 shrink-0 tabular-nums text-white/50">
                        {formatDate(d.date)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-white/70" title={d.raw}>
                        {d.detail || d.raw}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Change history */}
      {recentChanges.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-white/30">
            Recent changes
          </h3>
          <ul className="space-y-3">
            {recentChanges.map((c) => (
              <li key={c.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="text-white">{c.label}</span>
                  <span className="text-white/40">{c.summary}</span>
                  {c.keywordHits && (
                    <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-200">
                      {c.keywordHits}
                    </span>
                  )}
                  <span className="text-xs text-white/30">{timeAgo(c.detectedAt)}</span>
                </div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-xs text-white/50">
                  {c.diff}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
