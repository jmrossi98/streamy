"use client";

import { useEffect, useState } from "react";
import { ApplyReviewDialog } from "@/components/ApplyReviewDialog";
import {
  CATEGORY_LABELS,
  LEVEL_LABELS,
  LEVEL_ORDER,
  type JobCategory,
  type JobLevel,
} from "@/lib/jobFilters";

/**
 * How recently a posting must have first appeared to count as NEW.
 *
 * A day rather than "the latest poll": polls run every 30 minutes and most add
 * one or two postings, so the latest batch alone was usually a single row.
 */
const NEW_WITHIN_MS = 24 * 3600_000;

/** Filter choices kept per browser, so the panel opens the way it was left. */
// v2: v1 could hold the short-lived "mid"/"senior" levels, which no longer exist.
const PREFS_KEY = "streamy.jobs.filters.v2";
type Prefs = { levels: string[]; hiddenTags: string[]; onlyNew: boolean; hideOpened: boolean };

function loadPrefs(): Partial<Prefs> | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : null;
  } catch {
    return null;
  }
}

function savePrefs(prefs: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked storage: the filters still work, just unsaved.
  }
}

export type JobListingRow = {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  /** Metro keys, comma-separated. Empty when the match was remote-only. */
  metros: string;
  remote: boolean;
  category: string;
  level: string;
  /** Already opened from here at least once. */
  opened: boolean;
  /** The company's grouping, e.g. "startup". */
  tag: string | null;
  /** When the provider says it was posted, when it says at all. */
  postedAt: string | null;
  firstSeen: string;
  /** The newest prepared application for this listing, if any. */
  application: { id: string; status: string } | null;
};

/** Auto-apply covers the boards whose forms can be read ahead of time. */
const canAutoApply = (id: string) => /^(greenhouse|ashby):/.test(id);

const METRO_LABELS: Record<string, string> = {
  nyc: "New York",
  chicago: "Chicago",
  la: "Los Angeles",
  bay: "SF Bay Area",
  seattle: "Seattle",
};

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Open software roles in the watched metros.
 *
 * Ordered by when we first saw a posting, not by the provider's posted date:
 * providers backdate, omit that field, and re-stamp it on edits, so "new to us"
 * is the only ordering that reliably puts a fresh posting at the top -- which is
 * the whole purpose of the list.
 *
 * A posting open in several cities carries several metro badges rather than
 * being filed under one, because that is what the source actually says.
 */
/**
 * One labelled row of pills, any number of which can be on at once.
 *
 * Multi-select rather than exclusive: "New York or Seattle" and "AI or
 * embedded" are the questions actually being asked, and with exclusive pills
 * the only way to ask them was to look twice and hold the first answer in your
 * head. An empty selection means no filter, which is why the row still carries
 * an explicit "any" pill -- it is how you get back, and it reads as a state
 * rather than as the absence of one.
 */
function FilterRow({
  label,
  options,
  selected,
  onToggle,
  onClear,
  anyLabel = "Any",
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
  /** The "nothing selected" pill -- "Any" for include filters, "None" for Hide. */
  anyLabel?: string;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <span className="w-14 shrink-0 text-white/30">{label}</span>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={onClear}
          className={`rounded border px-2 py-0.5 transition-colors ${
            selected.size === 0
              ? "border-white/40 bg-white/15 text-white"
              : "border-white/15 text-white/55 hover:bg-white/10"
          }`}
        >
          {anyLabel}
        </button>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onToggle(option.key)}
            aria-pressed={selected.has(option.key)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              selected.has(option.key)
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/15 text-white/55 hover:bg-white/10"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Adds or removes one key, for a filter that holds several at once. */
function toggleIn(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function JobListingsPanel({
  listings,
  configured,
}: {
  listings: JobListingRow[];
  configured: boolean;
}) {
  // Sets rather than single values: each filter holds any number of choices at
  // once, and an empty set means that filter is off.
  const [metros, setMetros] = useState<Set<string>>(new Set());
  const [company, setCompany] = useState<string>("all");
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  /** Company groups to leave out, e.g. quant firms and startups. */
  const [hiddenTags, setHiddenTags] = useState<Set<string>>(new Set());
  /** Only postings first seen within NEW_WITHIN_MS. */
  const [onlyNew, setOnlyNew] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Fixed at mount: "new" is judged against when the page was opened, which
  // keeps render pure and the badge from flickering off mid-read.
  const [now] = useState(() => Date.now());
  /** Newest first by default: this is a list you check for what changed. */
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "company">("newest");
  const [hideOpened, setHideOpened] = useState(false);
  /**
   * Opened in this session, on top of what the server already knew.
   *
   * Kept locally as well so a row greys out the instant it is clicked, rather
   * than on the next page load -- the click opens a new tab, so without this
   * the list you come back to looks untouched.
   */
  const [openedNow, setOpenedNow] = useState<Set<string>>(new Set());
  /** Tailored-resume state per listing: working, the new version, or why it failed. */
  const [tailoring, setTailoring] = useState<Record<string, "busy" | { id: string } | { error: string }>>({});

  /** Auto-apply per listing: preparing, the packet to review, or why it failed. */
  const [applying, setApplying] = useState<Record<string, "busy" | { id: string; status: string } | { error: string }>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);

  async function prepareApplication(id: string) {
    setApplying((prev) => ({ ...prev, [id]: "busy" }));
    try {
      const res = await fetch("/api/admin/jobs/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && data.id) {
        setApplying((prev) => ({ ...prev, [id]: { id: data.id!, status: "ready" } }));
        setReviewing(data.id);
      } else {
        setApplying((prev) => ({ ...prev, [id]: { error: data.error ?? `Failed (HTTP ${res.status})` } }));
      }
    } catch {
      setApplying((prev) => ({ ...prev, [id]: { error: "Network error" } }));
    }
  }

  async function tailorResume(id: string) {
    setTailoring((prev) => ({ ...prev, [id]: "busy" }));
    try {
      const res = await fetch("/api/admin/jobs/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      setTailoring((prev) => ({
        ...prev,
        [id]: res.ok && data.id ? { id: data.id } : { error: data.error ?? `Failed (HTTP ${res.status})` },
      }));
    } catch {
      setTailoring((prev) => ({ ...prev, [id]: { error: "Network error" } }));
    }
  }

  // Restored after mount rather than in the initial state, so the server
  // render and the first client render agree.
  useEffect(() => {
    const saved = loadPrefs();
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect */
      if (Array.isArray(saved.levels)) setLevels(new Set(saved.levels));
      if (Array.isArray(saved.hiddenTags)) setHiddenTags(new Set(saved.hiddenTags));
      if (typeof saved.onlyNew === "boolean") setOnlyNew(saved.onlyNew);
      if (typeof saved.hideOpened === "boolean") setHideOpened(saved.hideOpened);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs({ levels: [...levels], hiddenTags: [...hiddenTags], onlyNew, hideOpened });
  }, [prefsLoaded, levels, hiddenTags, onlyNew, hideOpened]);

  function markOpened(id: string) {
    setOpenedNow((prev) => new Set(prev).add(id));
    // Fire and forget: the link opens regardless, and a failed mark is worth
    // one un-greyed row, never a delayed or blocked navigation.
    void fetch("/api/admin/jobs/opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => undefined);
  }

  if (!configured) {
    return (
      <p className="text-sm text-white/60">
        No job boards configured. Set <code className="text-white/80">JOB_BOARD_SOURCES</code> to a
        comma-separated list of <code className="text-white/80">provider:slug</code> entries
        (providers: greenhouse, ashby), e.g.{" "}
        <code className="text-white/80">greenhouse:stripe,ashby:ramp:Ramp</code>.
      </p>
    );
  }

  const present = new Set<string>();
  for (const l of listings) {
    for (const m of l.metros.split(",").filter(Boolean)) present.add(m);
    if (l.remote) present.add("remote");
  }

  // Only companies that actually have something open, so the list is not a
  // roster of every board configured -- most of which have nothing matching on
  // any given day.
  // Counted, and alphabetical rather than ranked: with sixty-odd boards the
  // dropdown is something you look a company up in, not something you browse,
  // and the count answers "is it worth picking" without selecting it first.
  const companyCounts = new Map<string, number>();
  for (const l of listings) {
    companyCounts.set(l.company, (companyCounts.get(l.company) ?? 0) + 1);
  }
  const companies = [...companyCounts.keys()].sort((a, b) => a.localeCompare(b));

  const isOpened = (l: JobListingRow) => l.opened || openedNow.has(l.id);
  const isNew = (l: JobListingRow) => now - (Date.parse(l.firstSeen) || 0) < NEW_WITHIN_MS;

  // Each filter is OR within itself and AND across filters: "New York or
  // Seattle" AND "AI or embedded". An empty set means that filter is off.
  const byMetro =
    metros.size === 0
      ? listings
      : listings.filter(
          (l) =>
            (metros.has("remote") && l.remote) ||
            l.metros.split(",").some((m) => metros.has(m))
        );
  const byCompany = company === "all" ? byMetro : byMetro.filter((l) => l.company === company);
  const byCategory =
    categories.size === 0 ? byCompany : byCompany.filter((l) => categories.has(l.category));
  const byTag =
    tags.size === 0 ? byCategory : byCategory.filter((l) => l.tag && tags.has(l.tag));
  const byHidden =
    hiddenTags.size === 0 ? byTag : byTag.filter((l) => !(l.tag && hiddenTags.has(l.tag)));
  const byLevel = levels.size === 0 ? byHidden : byHidden.filter((l) => levels.has(l.level));
  const byNew = onlyNew ? byLevel.filter(isNew) : byLevel;
  const visible = hideOpened ? byNew.filter((l) => !isOpened(l)) : byNew;

  // When a posting was advertised, falling back to when we first saw it. Some
  // providers give no date at all, and for those "new to us" is the only
  // honest answer -- it is also what notifications key off.
  const dateOf = (l: JobListingRow) => Date.parse(l.postedAt ?? l.firstSeen) || 0;
  const shown = [...visible].sort((a, b) => {
    if (sortBy === "company") return a.company.localeCompare(b.company) || a.title.localeCompare(b.title);
    return sortBy === "oldest" ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a);
  });
  const openedCount = listings.filter(isOpened).length;
  const newCount = listings.filter(isNew).length;

  // Only categories actually present, so the row is not a list of buckets that
  // happen to exist in the code.
  const presentCategories = [...new Set(listings.map((l) => l.category))].filter(
    (c): c is JobCategory => c in CATEGORY_LABELS
  );

  // Only groups actually in use, so the row does not offer a filter that
  // matches nothing.
  const presentTags = [...new Set(listings.map((l) => l.tag).filter((t): t is string => !!t))].sort();

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="text-white/40">
          {shown.length === listings.length
            ? `${listings.length} open role${listings.length === 1 ? "" : "s"}`
            : `${shown.length} of ${listings.length} open roles`}
        </span>

        {/* A select rather than pills: sixty-odd companies would be a wall of
            buttons above the thing you came to read. */}
        <label className="flex items-center gap-1.5">
          <span className="text-white/30">Company</span>
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="max-w-[16rem] streamy-select rounded border border-white/15 bg-black/40 py-1.5 pl-3 text-xs text-white focus:border-white/40 focus:outline-none"
          >
            <option value="all">All companies ({listings.length})</option>
            {companies.map((name) => (
              <option key={name} value={name}>
                {name} ({companyCounts.get(name)})
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-white/30">Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="streamy-select rounded border border-white/15 bg-black/40 py-1.5 pl-3 text-xs text-white focus:border-white/40 focus:outline-none"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="company">By company</option>
          </select>
        </label>

        {openedCount > 0 && (
          <label className="flex items-center gap-1.5 text-white/40">
            <input
              type="checkbox"
              checked={hideOpened}
              onChange={(e) => setHideOpened(e.target.checked)}
            />
            Hide explored ({openedCount})
          </label>
        )}

        <label className="flex items-center gap-1.5 text-white/40">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
          Only new ({newCount})
        </label>

        {company !== "all" && (
          <button
            type="button"
            onClick={() => setCompany("all")}
            className="text-white/40 underline-offset-2 transition-colors hover:text-white/70 hover:underline"
          >
            clear
          </button>
        )}
      </div>

      <FilterRow
        label="Location"
        selected={metros}
        onToggle={(k) => setMetros((prev) => toggleIn(prev, k))}
        onClear={() => setMetros(new Set())}
        options={[
          ...Object.keys(METRO_LABELS)
            .filter((k) => present.has(k))
            .map((k) => ({ key: k, label: METRO_LABELS[k] })),
          ...(present.has("remote") ? [{ key: "remote", label: "Remote" }] : []),
        ]}
      />

      <FilterRow
        label="Role"
        selected={categories}
        onToggle={(k) => setCategories((prev) => toggleIn(prev, k))}
        onClear={() => setCategories(new Set())}
        options={presentCategories.map((c) => ({ key: c, label: CATEGORY_LABELS[c] }))}
      />

      <FilterRow
        label="Company"
        selected={tags}
        onToggle={(k) => setTags((prev) => toggleIn(prev, k))}
        onClear={() => setTags(new Set())}
        options={presentTags.map((t) => ({
          key: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
        }))}
      />

      <FilterRow
        label="Hide"
        selected={hiddenTags}
        onToggle={(k) => setHiddenTags((prev) => toggleIn(prev, k))}
        onClear={() => setHiddenTags(new Set())}
        anyLabel="None"
        options={presentTags.map((t) => ({
          key: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
        }))}
      />

      <FilterRow
        label="Level"
        selected={levels}
        onToggle={(k) => setLevels((prev) => toggleIn(prev, k))}
        onClear={() => setLevels(new Set())}
        options={LEVEL_ORDER.map((l) => ({
          key: l,
          label: LEVEL_LABELS[l],
        }))}
      />

      {listings.length === 0 ? (
        <p className="text-sm text-white/50">
          Nothing yet. Polls every 30 minutes, and emails when something new appears.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-white/50">
          {/* Named from the filters actually set, so it says why the list is
              empty rather than implying nothing is open anywhere. */}
          No open roles match
          {[
            company === "all" ? null : ` ${company}`,
            categories.size === 0
              ? null
              : ` ${[...categories].map((c) => CATEGORY_LABELS[c as JobCategory]).join(" or ")}`,
            levels.size === 0
              ? null
              : ` at ${[...levels].map((l) => LEVEL_LABELS[l as JobLevel].toLowerCase()).join(" or ")}`,
            metros.size === 0
              ? null
              : ` in ${[...metros]
                  .map((m) => (m === "remote" ? "remote" : METRO_LABELS[m]))
                  .join(" or ")}`,
          ]
            .filter(Boolean)
            .join("")}
          {onlyNew ? ", new today" : ""}
          {hideOpened ? ", unexplored." : "."}
        </p>
      ) : (
        <ul className="max-h-[48rem] space-y-1.5 overflow-y-auto pr-1">
          {shown.map((listing) => (
            <li
              key={listing.id}
              className={`rounded border px-3 py-2 ${
                isOpened(listing)
                  ? "border-white/5 bg-black/10"
                  : "border-white/10 bg-black/20"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() => markOpened(listing.id)}
                    onAuxClick={(e) => {
                      // Middle-click opens a tab too, and is how most links
                      // here actually get used.
                      if (e.button === 1) markOpened(listing.id);
                    }}
                    className={`block truncate text-xs font-medium hover:underline ${
                      isOpened(listing) ? "text-white/45" : "text-white"
                    }`}
                  >
                    {listing.title}
                  </a>
                  <p className="mt-0.5 truncate text-[11px] text-white/50">
                    {listing.company} · {listing.location}
                  </p>
                </div>
                <span
                  className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/35"
                  title={
                    listing.postedAt
                      ? `Posted ${new Date(listing.postedAt).toLocaleDateString()}`
                      : `First seen ${new Date(listing.firstSeen).toLocaleDateString()}`
                  }
                >
                  {(() => {
                    const t = tailoring[listing.id];
                    if (t === "busy") return <span className="text-white/50">tailoring resume…</span>;
                    if (t && "id" in t)
                      return (
                        <a
                          href={`/resume/${t.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300 hover:underline"
                        >
                          open resume
                        </a>
                      );
                    return (
                      <button
                        type="button"
                        onClick={() => void tailorResume(listing.id)}
                        title={t && "error" in t ? t.error : "Write a resume tailored to this listing"}
                        className={`rounded border px-1.5 py-0.5 hover:bg-white/10 ${
                          t && "error" in t ? "border-red-400/40 text-red-300" : "border-white/15 text-white/55"
                        }`}
                      >
                        {t && "error" in t ? "retry resume" : "tailor resume"}
                      </button>
                    );
                  })()}
                  {canAutoApply(listing.id) &&
                    (() => {
                      const a = applying[listing.id] ?? listing.application;
                      if (a === "busy") return <span className="text-white/50">preparing application…</span>;
                      if (a && "id" in a)
                        return a.status === "submitted" ? (
                          <button
                            type="button"
                            onClick={() => setReviewing(a.id)}
                            className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300 hover:underline"
                          >
                            applied
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReviewing(a.id)}
                            className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300 hover:underline"
                          >
                            review application
                          </button>
                        );
                      return (
                        <button
                          type="button"
                          onClick={() => void prepareApplication(listing.id)}
                          title={a && "error" in a ? a.error : "Prepare the application: tailored resume plus an answer for every question on the form"}
                          className={`rounded border px-1.5 py-0.5 hover:bg-white/10 ${
                            a && "error" in a ? "border-red-400/40 text-red-300" : "border-sky-400/30 text-sky-300/80"
                          }`}
                        >
                          {a && "error" in a ? "retry apply" : "apply"}
                        </button>
                      );
                    })()}
                  {isOpened(listing) && <span className="text-white/25">explored</span>}
                  {/* The provider's own date when there is one, ours when
                      there is not -- and said out loud, because "posted 3d
                      ago" and "we noticed it 3d ago" are different claims. */}
                  {listing.postedAt
                    ? `posted ${timeAgo(listing.postedAt)}`
                    : `seen ${timeAgo(listing.firstSeen)}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {listing.metros
                  .split(",")
                  .filter(Boolean)
                  .map((key) => (
                    <span
                      key={key}
                      className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55"
                    >
                      {METRO_LABELS[key] ?? key}
                    </span>
                  ))}
                {listing.remote && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/55">
                    Remote
                  </span>
                )}
                {isNew(listing) && (
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    NEW
                  </span>
                )}
                {listing.level !== "midsenior" && listing.level in LEVEL_LABELS && (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
                    {LEVEL_LABELS[listing.level as JobLevel]}
                  </span>
                )}
                {listing.category in CATEGORY_LABELS && listing.category !== "swe" && (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
                    {CATEGORY_LABELS[listing.category as JobCategory]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {reviewing && (
        <ApplyReviewDialog
          id={reviewing}
          onClose={() => setReviewing(null)}
          onSubmitted={(postingId) =>
            setApplying((prev) => ({ ...prev, [postingId]: { id: reviewing, status: "submitted" } }))
          }
        />
      )}
    </div>
  );
}
