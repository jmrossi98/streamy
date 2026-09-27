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
  const companies = [...new Set(listings.map((l) => l.company))].sort((a, b) =>
    a.localeCompare(b)
  );

  const byMetro =
    metro === "all"
      ? listings
      : metro === "remote"
        ? listings.filter((l) => l.remote)
        : listings.filter((l) => l.metros.split(",").includes(metro));
  const byCompany = company === "all" ? byMetro : byMetro.filter((l) => l.company === company);
  const byCategory =
    category === "all" ? byCompany : byCompany.filter((l) => l.category === category);
  const shown = level === "all" ? byCategory : byCategory.filter((l) => l.level === level);

  // Only categories actually present, so the row is not a list of buckets that
  // happen to exist in the code.
  const categories = [...new Set(listings.map((l) => l.category))].filter(
    (c): c is JobCategory => c in CATEGORY_LABELS
  );

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-white/40">
          {shown.length === listings.length
            ? `${listings.length} open role${listings.length === 1 ? "" : "s"}`
            : `${shown.length} of ${listings.length} open roles`}
        </span>
        {/* A select rather than pills: there are dozens of boards, and a pill
            per company would be a wall of buttons above the thing you came to
            read. */}
        <label className="flex items-center gap-1.5 text-white/40">
          <span className="sr-only">Company</span>
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-xs text-white/80 outline-none focus:border-white/40"
          >
            <option value="all">All companies</option>
            {companies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-1">
          {["all", ...Object.keys(METRO_LABELS).filter((k) => present.has(k)), ...(present.has("remote") ? ["remote"] : [])].map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMetro(key)}
                className={`rounded border px-2 py-0.5 transition-colors ${
                  metro === key
                    ? "border-white/40 bg-white/15 text-white"
                    : "border-white/15 text-white/55 hover:bg-white/10"
                }`}
              >
                {key === "all" ? "All" : key === "remote" ? "Remote" : METRO_LABELS[key]}
              </button>
            )
          )}
        </div>
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {["all", ...categories].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`rounded border px-2 py-0.5 transition-colors ${
                category === key
                  ? "border-white/40 bg-white/15 text-white"
                  : "border-white/15 text-white/55 hover:bg-white/10"
              }`}
            >
              {key === "all" ? "All roles" : CATEGORY_LABELS[key as JobCategory]}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 text-xs">
        {["all", "entry", "midsenior", "staff"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setLevel(key)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              level === key
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/15 text-white/55 hover:bg-white/10"
            }`}
          >
            {key === "all" ? "Any level" : LEVEL_LABELS[key as JobLevel]}
          </button>
        ))}
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-white/50">
          Nothing yet. Polls every 30 minutes, and emails when something new appears.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-white/50">
          Nothing matching{company === "all" ? "" : ` at ${company}`}
          {metro === "all" ? "" : " there"} right now.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((listing) => (
            <li
              key={listing.id}
              className="rounded border border-white/10 bg-black/20 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block truncate text-xs font-medium text-white hover:underline"
                  >
                    {listing.title}
                  </a>
                  <p className="mt-0.5 truncate text-[11px] text-white/50">
                    {listing.company} · {listing.location}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-white/35">
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
