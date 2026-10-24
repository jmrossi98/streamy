"use client";

import { Badge, Button, Checkbox, Chip, Select, TextInput, type BadgeTone, scrollListClass } from "@/components/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEVEL_LABELS, LEVEL_ORDER } from "@/lib/jobFilters";
import { type SourceHealth, type SourceHealthStatus } from "@/lib/jobSourceHealthRules";
import { DIGEST_CADENCES, DIGEST_CADENCE_LABELS, type DigestCadence } from "@/lib/jobDigestRules";

export type JobSourceRow = {
  id: string;
  provider: string;
  slug: string;
  company: string;
  /** A career site mediabox scrapes, rather than an API board. */
  custom: boolean;
  enabled: boolean;
  notify: boolean;
  notifyImmediately: boolean;
  tag: string | null;
  /** Why the board is the way it is, e.g. switched off with no readable board. */
  note: string | null;
  /** How many open roles this board is currently contributing. */
  openRoles: number;
  health: SourceHealth;
};

const HEALTH_BADGE: Record<SourceHealthStatus, { label: string; tone: BadgeTone } | null> = {
  failing: { label: "Can't read", tone: "danger" },
  stale: { label: "Stale", tone: "warning" },
  empty: { label: "No roles", tone: "warning" },
  limited: { label: "Rate limited", tone: "info" },
  unchecked: { label: "Not polled yet", tone: "neutral" },
  ok: null,
  off: null,
};

/** Statuses whose detail is worth a line of its own under the row. */
const SHOW_DETAIL: SourceHealthStatus[] = ["failing", "stale", "empty", "limited"];

function HealthBadge({ health }: { health: SourceHealth }) {
  const badge = HEALTH_BADGE[health.status];
  if (!badge) return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" title={health.detail} />;
  return (
    <Badge tone={badge.tone} title={health.detail}>
      {badge.label}
    </Badge>
  );
}

function formatNext(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

type ToggleField = "enabled" | "notify" | "notifyImmediately";

/**
 * The boards being polled, and which of them are worth an email.
 *
 * Three switches, because they answer different questions. "Poll" is whether
 * to look at all -- turned off for a board that has started failing, without
 * losing how it was configured. "Email" is whether its new postings go in the
 * digest, which goes out on the cadence above. "Email immediately" is for the
 * few companies worth hearing about the moment a role appears.
 *
 * Since 2026-10-24 the career sites mediabox scrapes are rows here too
 * (badged Custom), and their Poll switch stops the scraper.
 */
export function JobSourcesPanel({
  sources,
  alertLevels: initialAlertLevels,
  digestCadence: initialCadence,
  nextDigestAt,
}: {
  /** Already sorted, problems first. */
  sources: JobSourceRow[];
  /** Job levels included in alert emails, across every board. */
  alertLevels: string[];
  digestCadence: DigestCadence;
  nextDigestAt: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(sources);
  const problems = rows.filter(
    (r) => HEALTH_BADGE[r.health.status] && r.health.status !== "unchecked" && r.health.status !== "limited"
  ).length;
  const [alertLevels, setAlertLevels] = useState<Set<string>>(new Set(initialAlertLevels));
  const [cadence, setCadence] = useState<DigestCadence>(initialCadence);
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

  async function changeCadence(next: DigestCadence) {
    const prev = cadence;
    setCadence(next);
    if (await send({ action: "digestCadence", cadence: next })) router.refresh();
    else setCadence(prev);
  }

  async function toggle(row: JobSourceRow, field: ToggleField) {
    const value = !row[field];
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: value } : r)));
    if (!(await send({ action: "toggle", id: row.id, field, value }))) {
      // Put it back: the switch should not show a state the server refused.
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: !value } : r)));
    }
  }

  const next = formatNext(nextDigestAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-white/40">Email digest</span>
        <Select
          fieldSize="sm"
          className="w-auto"
          value={cadence}
          aria-label="Email digest cadence"
          onChange={(e) => void changeCadence(e.target.value as DigestCadence)}
        >
          {DIGEST_CADENCES.map((c) => (
            <option key={c} value={c}>
              {DIGEST_CADENCE_LABELS[c]}
            </option>
          ))}
        </Select>
        <span className="text-white/35">
          {cadence === "off"
            ? "No digest. Boards set to Email immediately still email."
            : `New roles from boards with Email on are collected and sent together${next ? `; next around ${next}` : ""}. Boards are still polled every 30 minutes.`}
        </span>
      </div>

      {/* Which levels are emailed about, for every board with Email on. The
          panel above still lists every level; this only decides what arrives
          in the inbox. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="text-white/40">Email alerts for</span>
        {LEVEL_ORDER.map((level) => (
          <Chip key={level} size="xs" active={alertLevels.has(level)} onClick={() => void toggleAlertLevel(level)}>
            {LEVEL_LABELS[level]}
          </Chip>
        ))}
        {alertLevels.size === 0 && <span className="text-amber-300/80">no alerts will be sent</span>}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Provider</span>
          <Select fieldSize="sm" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="greenhouse">Greenhouse</option>
            <option value="ashby">Ashby</option>
            <option value="workday">Workday</option>
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: "14rem" }}>
          <span className="text-white/40">
            {provider === "workday" ? "tenant/wd5/SiteName" : "Company slug on that board"}
          </span>
          <TextInput
            fieldSize="sm"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={provider === "workday" ? "nvidia/wd5/NVIDIAExternalCareerSite" : "stripe"}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Display name (optional)</span>
          <TextInput fieldSize="sm" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Stripe" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-white/40">Group (optional)</span>
          <TextInput fieldSize="sm" className="w-24" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="startup" />
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !slug.trim()}>
          {busy ? "Checking…" : "Add board"}
        </Button>
      </form>
      <p className="text-[11px] text-white/35">
        A new board&apos;s first poll is taken quietly: the roles already open there are listed but not emailed.
      </p>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <p className={`text-xs ${problems > 0 ? "text-amber-300" : "text-white/45"}`}>
        {problems > 0
          ? `${problems} source${problems === 1 ? "" : "s"} not being read properly -- listed first. Hover a badge for why.`
          : "Every source read fine on its last poll."}
      </p>

      <ul className={scrollListClass({ tall: true }, "space-y-1")}>
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs"
          >
            <HealthBadge health={row.health} />
            <span className={`font-medium ${row.enabled ? "text-white/85" : "text-white/35"}`}>
              {row.company}
            </span>
            {row.custom ? (
              <Badge tone="info" title="Scraped from the company's career site by mediabox (job-scrape.py)">
                Custom
              </Badge>
            ) : (
              <span className="text-white/30">
                {row.provider}:{row.slug}
              </span>
            )}
            <span className="text-white/35">{row.openRoles} open</span>
            {row.tag && <Badge>{row.tag}</Badge>}
            {SHOW_DETAIL.includes(row.health.status) && (
              <span className="basis-full text-[11px] text-white/40">{row.health.detail}</span>
            )}
            {row.note && <span className="basis-full text-[11px] text-amber-200/70">{row.note}</span>}
            <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              <Checkbox
                label="Poll"
                title={row.custom ? "Scrape this site. Off stops the scraper on mediabox." : "Poll this board."}
                checked={row.enabled}
                onChange={() => void toggle(row, "enabled")}
              />
              <Checkbox
                label="Email"
                title="Include this board's new roles in the email digest. Off still polls and lists them."
                checked={row.notify}
                onChange={() => void toggle(row, "notify")}
              />
              <Checkbox
                label="Email immediately"
                title="Email this board's new roles as soon as a poll finds them, instead of waiting for the digest."
                checked={row.notifyImmediately}
                onChange={() => void toggle(row, "notifyImmediately")}
              />
              {!row.custom && (
                <Button size="xs" onClick={() => void remove(row)} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="text-sm text-white/50">No boards yet. Add one above.</p>
      )}
    </div>
  );
}
