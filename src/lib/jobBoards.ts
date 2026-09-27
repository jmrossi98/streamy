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

/**
 * spotify and github are single-company APIs, not multi-tenant platforms.
 *
 * They sit here rather than in the scraper because that is what they are:
 * plain public JSON, no browser, no markup parsing. Both were found by
 * watching what their careers page fetches (scripts/job-endpoint-discover.mjs
 * in mediabox-infra) rather than by guessing at URLs -- which is why the
 * earlier guesses all 404'd.
 *
 * A provider per company does not scale. Three of them is still readable at a
 * glance and each is about twenty lines, so the bespoke version is honest for
 * now -- but the threshold is real: once the endpoint, the array path and the
 * field names are all that differ, the right answer is one configurable
 * provider rather than a fourth near-copy. Treat a fourth as the trigger.
 */
export type JobProvider =
  | "greenhouse"
  | "ashby"
  | "workday"
  | "eightfold"
  | "spotify"
  | "github"
  | "atlassian";

export type JobSource = {
  /** Display name, e.g. "Stripe". */
  company: string;
  provider: JobProvider;
  /**
   * The company's slug on that provider.
   *
   * Greenhouse and Ashby take a plain company slug ("stripe"). Workday needs
   * three parts -- tenant, data-centre number and career-site name -- written
   * "nvidia/wd5/NVIDIAExternalCareerSite", because a Workday instance is
   * addressed by all three and there is no way to derive the last two.
   * Eightfold needs the careers host and the domain it filters by, written
   * "explore.jobs.netflix.net/netflix.com".
   */
  slug: string;
};

/** Tenant, wd number and site name, for a Workday source. */
export type WorkdayTarget = { tenant: string; dc: string; site: string };

/** Careers host and domain, for an Eightfold source. */
export type EightfoldTarget = { host: string; domain: string };

export function parseEightfoldSlug(slug: string): EightfoldTarget | null {
  const parts = slug.split("/");
  if (parts.length !== 2) return null;
  const [host, domain] = parts.map((x) => x.trim());
  // Both are hostnames; anything without a dot is a typo, not a host.
  if (!host.includes(".") || !domain.includes(".")) return null;
  return { host, domain };
}

export function parseWorkdaySlug(slug: string): WorkdayTarget | null {
  const parts = slug.split("/");
  if (parts.length !== 3) return null;
  const [tenant, dc, site] = parts.map((x) => x.trim());
  if (!tenant || !/^wd\d+$/.test(dc) || !site) return null;
  return { tenant, dc, site };
}

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
  if (source.provider === "spotify") {
    // The slug is the category to search, e.g. "engineering".
    return `https://api.lifeatspotify.com/wp-json/animal/v1/job/search?c=${encodeURIComponent(
      source.slug
    )}`;
  }
  if (source.provider === "atlassian") {
    // One flat list of every posting; the slug is unused but kept for shape.
    return "https://www.atlassian.com/endpoint/careers/listings";
  }
  if (source.provider === "github") {
    // The slug is the keyword to search. Paged by the fetcher.
    return `https://www.github.careers/api/jobs?keywords=${encodeURIComponent(
      source.slug
    )}&page=1&sortBy=relevance&descending=false&internal=false`;
  }
  if (source.provider === "eightfold") {
    const target = parseEightfoldSlug(source.slug);
    if (!target) return "";
    return `https://${target.host}/api/apply/v2/jobs?domain=${encodeURIComponent(
      target.domain
    )}&start=0&num=50`;
  }
  if (source.provider === "workday") {
    const target = parseWorkdaySlug(source.slug);
    if (!target) return "";
    const { tenant, dc, site } = target;
    return `https://${encodeURIComponent(tenant)}.${dc}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(
      tenant
    )}/${encodeURIComponent(site)}/jobs`;
  }
  const slug = encodeURIComponent(source.slug);
  switch (source.provider) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  }
}

/** Where a person actually applies, built from the path the API returns. */
function workdayJobUrl(target: WorkdayTarget, externalPath: string): string {
  const { tenant, dc, site } = target;
  return `https://${tenant}.${dc}.myworkdayjobs.com/en-US/${site}${externalPath}`;
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
/**
 * Workday's payload, which shares nothing with the other two.
 *
 * Its quirks, all of which matter:
 *   - `locationsText` is prose ("US, CA, Santa Clara"), and for a multi-site
 *     role it is literally "2 Locations" -- the places are simply not in the
 *     response. Those cannot be filed under a metro without fetching each job
 *     individually, so they are kept with their text as-is and the metro
 *     matcher declines them rather than guessing.
 *   - `postedOn` is relative prose ("Posted Today"), not a date, so postedAt
 *     stays null. Harmless here: "new" is measured by when we first saw a
 *     posting, never by the provider's own stamp.
 *   - the id lives in `bulletFields`, and the apply URL has to be built from
 *     `externalPath`.
 */
function parseWorkday(source: JobSource, payload: unknown): JobPosting[] {
  const target = parseWorkdaySlug(source.slug);
  if (!target) return [];
  const rows = (payload as { jobPostings?: unknown })?.jobPostings;
  if (!Array.isArray(rows)) return [];

  const out: JobPosting[] = [];
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const job = entry as Record<string, unknown>;
    const title = asString(job.title);
    const path = asString(job.externalPath);
    const bullets = Array.isArray(job.bulletFields) ? job.bulletFields : [];
    const id = asString(bullets[0]) || path;
    if (!title || !id) continue;

    out.push({
      id: `workday:${target.tenant}:${id}`,
      company: source.company,
      title,
      location: asString(job.locationsText) || "Unspecified",
      url: path ? workdayJobUrl(target, path) : boardUrl(source),
      postedAt: null,
    });
  }
  return out;
}

/**
 * Eightfold's payload.
 *
 * Better shaped than Workday's in the one way that matters here: a multi-site
 * role lists its places in `locations` rather than collapsing them to
 * "2 Locations", so those postings can still be filed under every metro they
 * are actually open in. The array is joined rather than picked from, because
 * the metro matcher reads all of them.
 */
function parseEightfold(source: JobSource, payload: unknown): JobPosting[] {
  const rows = (payload as { positions?: unknown })?.positions;
  if (!Array.isArray(rows)) return [];

  const out: JobPosting[] = [];
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const job = entry as Record<string, unknown>;
    const id = asString(job.id) || String(job.id ?? "");
    const title = asString(job.name);
    if (!id || id === "undefined" || !title) continue;

    const places = Array.isArray(job.locations)
      ? (job.locations as unknown[]).map((l) => asString(l)).filter(Boolean)
      : [];
    const location = places.length > 0 ? places.join("; ") : asString(job.location);

    // t_update is unix seconds; the other providers give ISO strings or
    // nothing, and the row stores whatever it is given.
    const updated = typeof job.t_update === "number" ? job.t_update : null;

    out.push({
      id: `eightfold:${source.slug.split("/")[1] ?? source.slug}:${id}`,
      company: source.company,
      title,
      location: location || "Unspecified",
      url: asString(job.canonicalPositionUrl) || boardUrl(source),
      postedAt: updated ? new Date(updated * 1000).toISOString() : null,
    });
  }
  return out;
}

/**
 * Spotify: {result: [{id, text, locations: [{location}], ...}]}.
 *
 * `text` is the title and `id` is a slug, which doubles as the apply URL path.
 * Locations are objects, and a role open in several lists all of them.
 */
function parseSpotify(source: JobSource, payload: unknown): JobPosting[] {
  const rows = (payload as { result?: unknown })?.result;
  if (!Array.isArray(rows)) return [];

  const out: JobPosting[] = [];
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const job = entry as Record<string, unknown>;
    const id = asString(job.id);
    const title = asString(job.text);
    if (!id || !title) continue;

    const places = Array.isArray(job.locations)
      ? (job.locations as Record<string, unknown>[])
          .map((l) => asString(l?.location) || asString(l?.name))
          .filter(Boolean)
      : [];

    out.push({
      id: `spotify:${id}`,
      company: source.company,
      title,
      location: places.join("; ") || "Unspecified",
      url: `https://www.lifeatspotify.com/jobs/${encodeURIComponent(id)}`,
      postedAt: null,
    });
  }
  return out;
}

/**
 * GitHub: {jobs: [{data: {slug, title, location_name, req_id, ...}}]}.
 *
 * Everything useful is nested one level down under `data`, and the apply URL is
 * built from the slug.
 */
function parseGithub(source: JobSource, payload: unknown): JobPosting[] {
  const rows = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(rows)) return [];

  const out: JobPosting[] = [];
  for (const entry of rows) {
    const data = (entry as { data?: unknown })?.data;
    if (typeof data !== "object" || data === null) continue;
    const job = data as Record<string, unknown>;
    const id = asString(job.req_id) || asString(job.slug);
    const title = asString(job.title);
    if (!id || !title) continue;

    const place = [asString(job.location_name), asString(job.country)]
      .filter(Boolean)
      .join(", ");

    out.push({
      id: `github:${id}`,
      company: source.company,
      title,
      location: place || "Unspecified",
      url: `https://www.github.careers/careers-home/jobs/${encodeURIComponent(
        asString(job.slug) || id
      )}`,
      postedAt: null,
    });
  }
  return out;
}

/**
 * Atlassian: a bare array of postings, each with `locations` and `applyUrl`.
 *
 * The plainest of the three -- no wrapper object, no nesting, and it hands
 * back the apply URL rather than making one up from a slug.
 */
function parseAtlassian(source: JobSource, payload: unknown): JobPosting[] {
  if (!Array.isArray(payload)) return [];

  const out: JobPosting[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) continue;
    const job = entry as Record<string, unknown>;
    const id = asString(job.id) || String(job.id ?? "");
    const title = asString(job.title);
    if (!id || id === "undefined" || !title) continue;

    const places = Array.isArray(job.locations)
      ? (job.locations as unknown[]).map((l) => asString(l)).filter(Boolean)
      : [asString(job.locations)].filter(Boolean);

    out.push({
      id: `atlassian:${id}`,
      company: source.company,
      title,
      location: places.join("; ") || "Unspecified",
      url: asString(job.applyUrl) || "https://www.atlassian.com/company/careers/all-jobs",
      postedAt: null,
    });
  }
  return out;
}

export function parseBoard(source: JobSource, payload: unknown): JobPosting[] {
  if (source.provider === "atlassian") return parseAtlassian(source, payload);
  if (source.provider === "spotify") return parseSpotify(source, payload);
  if (source.provider === "github") return parseGithub(source, payload);
  if (source.provider === "eightfold") return parseEightfold(source, payload);
  if (source.provider === "workday") return parseWorkday(source, payload);

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
    // Typed as the union rather than string[], so adding a provider to
    // JobProvider without adding it here is a compile error instead of a
    // silently-ignored line of configuration.
    const known: JobProvider[] = [
      "greenhouse",
      "ashby",
      "workday",
      "eightfold",
      "spotify",
      "github",
      "atlassian",
    ];
    if (!known.includes(provider as JobProvider)) continue;
    if (provider === "eightfold" && !parseEightfoldSlug(slug)) continue;
    // A Workday slug is "tenant/wdN/Site"; reject a malformed one here rather
    // than letting it through to fetch a URL that cannot exist.
    if (provider === "workday" && !parseWorkdaySlug(slug)) continue;
    const company = parts.slice(2).join(":").trim() || slug;
    out.push({ provider: provider as JobProvider, slug, company });
  }
  return out;
}
