"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEVEL_LABELS, LEVEL_ORDER } from "@/lib/jobFilters";
import { HEALTH_RANK, type SourceHealth, type SourceHealthStatus } from "@/lib/jobSourceHealthRules";

export type JobSourceRow = {
  id: string;
  provider: string;
  slug: string;
  company: string;
  enabled: boolean;
  notify: boolean;
  tag: string | null;
  /** How many open roles this board is currently contributing. */
  openRoles: number;
  health: SourceHealth;
};

export type ScrapedSiteRow = { company: string; count: number | null; health: SourceHealth };

const HEALTH_BADGE: Record<SourceHealthStatus, { label: string; className: string } | null> = {
  failing: { label: "Can't read", className: "bg-red-500/20 text-red-300" },
  stale: { label: "Stale", className: "bg-amber-500/20 text-amber-300" },
  empty: { label: "No roles", className: "bg-amber-500/15 text-amber-200/80" },
  unchecked: { label: "Not polled yet", className: "bg-white/10 text-white/50" },
  ok: null,
  off: null,
};

function HealthBadge({ health }: { health: SourceHealth }) {
  const badge = HEALTH_BADGE[health.status];
  if (!badge) return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" title={health.detail} />;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`} title={health.detail}>
      {badge.label}
    </span>
  );
}

/**
 * The boards being polled, and which of them are worth an email.
 *
 * Two switches rather than one, because they answer different questions.
 * "Polling" is whether to look at all -- turned off for a board that has
 * started failing, without losing how it was configured. "Notify" is whether a
 * new posting there should interrupt someone, which is a much lower bar to
 * clear: a company can be worth watching in a list without being worth an
 * email at two in the morning.
 */
export function JobSourcesPanel({
  sources,
  scrapedSites,
  alertLevels: initialAlertLevels,
}: {
  sources: JobSourceRow[];
  /** Career sites mediabox scrapes; configured in the scraper, so read-only here. */
  scrapedSites: ScrapedSiteRow[];
  /** Job levels included in alert emails, across every board. */
  alertLevels: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() =>
    [...sources].sort((a, b) => HEALTH_RANK[a.health.status] - HEALTH_RANK[b.health.status])
  );
  const problems =
    rows.filter((r) => HEALTH_BADGE[r.health.status] && r.health.status !== "unchecked").length +
    scrapedSites.filter((s) => HEALTH_BADGE[s.health.status] && s.health.status !== "unchecked").length;
  const [alertLevels, setAlertLevels] = useState<Set<string>>(new Set(initialAlertLevels));
  const [provider, setProvider] = useState("greenhouse");
  const [slug, setSlug] = useState("");
  const [company, setCompany] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>): Promise<boolean> {
    setError(null);
    const res = await fetch("/api/admin/job-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim()) return;
    setBusy(true);
    try {
      // The server checks the board actually answers before storing it, so a
      // mistyped slug is rejected here rather than sitting in the list
      // contributing nothing.
      if (
        await send({
          action: "add",
          provider,
          slug: slug.trim(),
          company: company.trim(),
          tag: tag.trim(),
        })
      ) {
        setSlug("");
        setCompany("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: JobSourceRow) {
    if (!window.confirm(`Stop watching ${row.company}?`)) return;
    setBusy(true);
    try {
      if (await send({ action: "remove", id: row.id })) {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleAlertLevel(level: string) {
    const prev = alertLevels;
    const next = new Set(prev);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    setAlertLevels(next);
    // Put it back if the server refused, so the pills never show a setting
    // that is not the one emails are actually using.
    if (!(await send({ action: "alertLevels", levels: [...next] }))) setAlertLevels(prev);
  }

  async function toggle(row: JobSourceRow, field: "enabled" | "notify") {
    const value = !row[field];
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    if (!(await send({ action: "toggle", id: row.id, field, value }))) {
      // Put it back: the switch should not show a state the server refused.
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: !value } : r)));
    }
  }

  return (
    <div className="space-y-4">
      {/* Which levels are emailed about, for every board with Email on. The
          panel above still lists every level; this only decides what arrives
          in the inbox. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="text-white/40">Email alerts for</span>
        {LEVEL_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => void toggleAlertLevel(level)}
            aria-pressed={alertLevels.has(level)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              alertLevels.has(level)
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/15 text-white/55 hover:bg-white/10"
            }`}
          >
            {LEVEL_LABELS[level]}
          </button>
        ))}
        {alertLevels.size === 0 && <span className="text-amber-300/80">no alerts will be sent</span>}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="streamy-select rounded border border-white/15 bg-black/40 py-1.5 pl-3 text-xs text-white focus:border-white/40 focus:outline-none"
          >
            <option value="greenhouse">Greenhouse</option>
            <option value="ashby">Ashby</option>
            <option value="workday">Workday</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: "14rem" }}>
          <span className="text-white/40">
            {provider === "workday" ? "tenant/wd5/SiteName" : "Company slug on that board"}
          </span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={provider === "workday" ? "nvidia/wd5/NVIDIAExternalCareerSite" : "stripe"}
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-white outline-none focus:border-white/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Display name (optional)</span>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Stripe"
            className="rounded border border-white/15 bg-black/40 px-2 py-1.5 text-white outline-none focus:border-white/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Group (optional)</span>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="startup"
            className="w-24 rounded border border-white/15 bg-black/40 px-2 py-1.5 text-white outline-none focus:border-white/40"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !slug.trim()}
          className="rounded bg-netflix-red px-3 py-1.5 font-medium text-white transition-colors hover:bg-netflix-red/90 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Add board"}
        </button>
      </form>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <p className={`text-xs ${problems > 0 ? "text-amber-300" : "text-white/45"}`}>
        {problems > 0
          ? `${problems} source${problems === 1 ? "" : "s"} not being read properly -- listed first. Hover a badge for why.`
          : "Every source read fine on its last poll."}
      </p>

      <ul className="max-h-[36rem] space-y-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs"
          >
            <HealthBadge health={row.health} />
            <span className={`font-medium ${row.enabled ? "text-white/85" : "text-white/35"}`}>
              {row.company}
            </span>
            <span className="text-white/30">
              {row.provider}:{row.slug}
            </span>
            <span className="text-white/35">{row.openRoles} open</span>
            {(row.health.status === "failing" || row.health.status === "stale" || row.health.status === "empty") && (
              <span className="basis-full text-[11px] text-white/40">{row.health.detail}</span>
            )}
            {row.tag && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                {row.tag}
              </span>
            )}
            <label className="ml-auto flex items-center gap-1 text-white/50">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={() => void toggle(row, "enabled")}
              />
              Poll
            </label>
            <label className="flex items-center gap-1 text-white/50">
              <input
                type="checkbox"
                checked={row.notify}
                onChange={() => void toggle(row, "notify")}
              />
              <span title="Include this board's new roles in alert emails. Off still polls and lists them.">
                Email
              </span>
            </label>
            <button
              type="button"
              onClick={() => void remove(row)}
              className="rounded border border-white/15 px-2 py-0.5 text-white/60 transition-colors hover:bg-white/10"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="text-sm text-white/50">No boards yet. Add one above.</p>
      )}

      {scrapedSites.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-white/40">Scraped career sites</h3>
          <ul className="space-y-1">
            {scrapedSites.map((site) => (
              <li
                key={site.company}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs"
              >
                <HealthBadge health={site.health} />
                <span className="font-medium text-white/85">{site.company}</span>
                <span className="text-white/30">scraped</span>
                <span className="text-white/35">{site.count ?? 0} found</span>
                {site.health.status !== "ok" && (
                  <span className="text-white/40">{site.health.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
