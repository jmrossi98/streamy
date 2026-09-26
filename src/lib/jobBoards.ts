/**
 * Job listings straight from the applicant-tracking systems companies already
 * publish them through.
 *
 * A careers page is almost never where the data lives. Most tech companies run
 * Greenhouse or Ashby, and the page you see is a thin front-end over a public,
 * unauthenticated JSON endpoint -- the same one the company's own page calls.
 * Reading that endpoint gives structured title/location/url/posted-at fields
 * instead of HTML that changes shape whenever marketing touches the site, and
 * it is a documented public interface rather than something to be got past.
 *
 * That is also what removes the need for rotating egress. Scraping the
 * rendered page is what runs into Cloudflare and rate limits; these endpoints
 * are meant to be read, so one polite request per company per interval does
 * the job. Measured 2026-09-26: Greenhouse returned 200 and 438 KB for one
 * company, Ashby 200 and 2.6 MB, from an ordinary residential IP with no
 * headers set.
 *
 * Only providers actually verified against a live endpoint are here. A
 * provider that silently returns nothing is worse than an absent one, because
 * the panel then reads as "no jobs" rather than "not wired up".
 */

export type JobProvider = "greenhouse" | "ashby";

export type JobSource = {
  /** Display name, e.g. "Stripe". */
  company: string;
  provider: JobProvider;
  /** The company's slug on that provider, e.g. "stripe". */
  slug: string;
};

export type JobPosting = {
  /** Stable per provider, so a re-poll updates rather than duplicates. */
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  /** ISO timestamp, or null when the provider doesn't say. */
  postedAt: string | null;
};

/** The public endpoint listing a company's open roles. */
export function boardUrl(source: JobSource): string {
  const slug = encodeURIComponent(source.slug);
  switch (source.provider) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  }
}

/** A public link a person can actually open and apply through. */
function fallbackUrl(source: JobSource, id: string): string {
  const slug = encodeURIComponent(source.slug);
  return source.provider === "greenhouse"
    ? `https://boards.greenhouse.io/${slug}/jobs/${encodeURIComponent(id)}`
    : `https://jobs.ashbyhq.com/${slug}/${encodeURIComponent(id)}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalises one provider's payload into postings.
 *
 * Takes already-parsed JSON rather than fetching, so the shape handling is
 * testable against real payloads without network. Anything missing a title or
 * an id is dropped rather than rendered as a blank row -- these feeds are
 * third-party and occasionally carry drafts.
 */
export function parseBoard(source: JobSource, payload: unknown): JobPosting[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { jobs?: unknown })?.jobs)
      ? ((payload as { jobs: unknown[] }).jobs)
      : [];

  const out: JobPosting[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const job = entry as Record<string, unknown>;

    const id = asString(job.id) || asString(job.jobId) || String(job.id ?? "");
    const title = asString(job.title) || asString(job.text);
    if (!id || id === "undefined" || !title) continue;

    // Greenhouse nests location as {name}; Ashby gives a plain string.
    const locationField = job.location;
    const location =
      typeof locationField === "string"
        ? locationField.trim()
        : asString((locationField as { name?: unknown })?.name);

    const url =
      asString(job.absolute_url) || asString(job.jobUrl) || fallbackUrl(source, id);

    const postedAt =
      asString(job.updated_at) ||
      asString(job.publishedAt) ||
      asString(job.created_at) ||
      null;

    out.push({
      id: `${source.provider}:${source.slug}:${id}`,
      company: source.company,
      title,
      location: location || "Unspecified",
      url,
      postedAt: postedAt || null,
    });
  }
  return out;
}

/**
 * Parses the company list from configuration.
 *
 * One per line or comma-separated, each `provider:slug` or
 * `provider:slug:Display Name`. The display name is optional because for most
 * companies the slug is already the name.
 */
export function parseJobSources(raw: string | null | undefined): JobSource[] {
  if (!raw) return [];
  const out: JobSource[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const parts = line.trim().split(":");
    if (parts.length < 2) continue;
    const provider = parts[0].trim().toLowerCase();
    const slug = parts[1].trim();
    if (!slug) continue;
    if (provider !== "greenhouse" && provider !== "ashby") continue;
    const company = parts.slice(2).join(":").trim() || slug;
    out.push({ provider, slug, company });
  }
  return out;
}
