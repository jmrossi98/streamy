"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
};

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
export function JobSourcesPanel({ sources }: { sources: JobSourceRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(sources);
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

      <ul className="max-h-[36rem] space-y-1 overflow-y-auto pr-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-white/10 bg-black/20 px-3 py-2 text-xs"
          >
            <span className={`font-medium ${row.enabled ? "text-white/85" : "text-white/35"}`}>
              {row.company}
            </span>
            <span className="text-white/30">
              {row.provider}:{row.slug}
            </span>
            <span className="text-white/35">{row.openRoles} open</span>
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
              Notify
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
    </div>
  );
}
