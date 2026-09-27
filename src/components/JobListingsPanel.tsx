"use client";

import { useState } from "react";
import { CATEGORY_LABELS, LEVEL_LABELS, type JobCategory, type JobLevel } from "@/lib/jobFilters";

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
  firstSeen: string;
};

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
 * One labelled row of pills.
 *
 * Extracted because location, role and level were three hand-rolled rows that
 * had drifted: location sat inline with the header and pushed right, the other
 * two sat below it with no label. Reading which filters were even available
 * meant scanning three different shapes.
 */
function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  if (options.length <= 2) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <span className="w-14 shrink-0 text-white/30">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              value === option.key
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

export function JobListingsPanel({
  listings,
  configured,
}: {
  listings: JobListingRow[];
  configured: boolean;
}) {
  const [metro, setMetro] = useState<string>("all");
  const [company, setCompany] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [level, setLevel] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [hideOpened, setHideOpened] = useState(false);
  /**
   * Opened in this session, on top of what the server already knew.
   *
   * Kept locally as well so a row greys out the instant it is clicked, rather
   * than on the next page load -- the click opens a new tab, so without this
   * the list you come back to looks untouched.
   */
  const [openedNow, setOpenedNow] = useState<Set<string>>(new Set());

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

  const byMetro =
    metro === "all"
      ? listings
      : metro === "remote"
        ? listings.filter((l) => l.remote)
        : listings.filter((l) => l.metros.split(",").includes(metro));
  const byCompany = company === "all" ? byMetro : byMetro.filter((l) => l.company === company);
  const byCategory =
    category === "all" ? byCompany : byCompany.filter((l) => l.category === category);
  const byTag = tag === "all" ? byCategory : byCategory.filter((l) => l.tag === tag);
  const byLevel = level === "all" ? byTag : byTag.filter((l) => l.level === level);
  const isOpened = (l: JobListingRow) => l.opened || openedNow.has(l.id);
  const shown = hideOpened ? byLevel.filter((l) => !isOpened(l)) : byLevel;
  const openedCount = listings.filter(isOpened).length;

  // Only categories actually present, so the row is not a list of buckets that
  // happen to exist in the code.
  const categories = [...new Set(listings.map((l) => l.category))].filter(
    (c): c is JobCategory => c in CATEGORY_LABELS
  );

  // Only groups actually in use, so the row does not offer a filter that
  // matches nothing.
  const tags = [...new Set(listings.map((l) => l.tag).filter((t): t is string => !!t))].sort();

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
        value={metro}
        onChange={setMetro}
        options={[
          { key: "all", label: "Anywhere" },
          ...Object.keys(METRO_LABELS)
            .filter((k) => present.has(k))
            .map((k) => ({ key: k, label: METRO_LABELS[k] })),
          ...(present.has("remote") ? [{ key: "remote", label: "Remote" }] : []),
        ]}
      />

      <FilterRow
        label="Role"
        value={category}
        onChange={setCategory}
        options={[
          { key: "all", label: "Any role" },
          ...categories.map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
        ]}
      />

      <FilterRow
        label="Company"
        value={tag}
        onChange={setTag}
        options={[
          { key: "all", label: "Any size" },
          ...tags.map((t) => ({ key: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
        ]}
      />

      <FilterRow
        label="Level"
        value={level}
        onChange={setLevel}
        options={[
          { key: "all", label: "Any level" },
          ...(["entry", "midsenior", "staff"] as JobLevel[]).map((l) => ({
            key: l,
            label: LEVEL_LABELS[l],
          })),
        ]}
      />

      {listings.length === 0 ? (
        <p className="text-sm text-white/50">
          Nothing yet. Polls every 30 minutes, and emails when something new appears.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-white/50">
          {/* Assembled from the filters actually set, so it reads as a sentence
              rather than stitching fragments that each assume the others. */}
          No open roles
          {[
            company === "all" ? null : ` at ${company}`,
            category === "all" ? null : ` in ${CATEGORY_LABELS[category as JobCategory]}`,
            level === "all" ? null : ` at ${LEVEL_LABELS[level as JobLevel].toLowerCase()}`,
            metro === "all"
              ? null
              : metro === "remote"
                ? " that are remote"
                : ` in ${METRO_LABELS[metro]}`,
          ]
            .filter(Boolean)
            .join("")}
          {hideOpened ? " left to explore." : "."}
        </p>
      ) : (
        <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
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
                <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/35">
                  {isOpened(listing) && <span className="text-white/25">explored</span>}
                  {timeAgo(listing.firstSeen)}
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
    </div>
  );
}
