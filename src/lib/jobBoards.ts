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
 * Four of them now, which is the threshold the previous version of this comment
 * named: once the endpoint, the array path and the field names are all that
 * differ between them, four near-identical parsers are four places to fix the
 * same bug. They are one parser driven by CUSTOM_BOARDS below.
 *
 * The provider names stay in the union rather than collapsing to a single
 * "custom" with the shape encoded in configuration. That keeps a board row
 * readable -- "microsoft:software engineer" says what it is -- and keeps the
 * shapes in code where they can be typed, instead of in a slug string that
 * nothing validates.
 */
export type JobProvider =
  | "greenhouse"
  | "ashby"
  | "workday"
  | "eightfold"
  | "spotify"
  | "github"
  | "atlassian"
  | "microsoft";

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
  const custom = CUSTOM_BOARDS[source.provider];
  if (custom) {
    return custom.endpoint.replace("{q}", encodeURIComponent(source.slug));
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
    default:
      return "";
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
 * How to read one company's own JSON. Everything these four differ by, as data.
 *
 * `list` is a dotted path to the array of postings ("" when the payload *is*
 * the array). `row` is a path within each entry, for APIs that wrap each
 * posting in another object. The rest are field names.
 */
export type CustomBoard = {
  /** `{q}` is replaced by the source's slug. */
  endpoint: string;
  list: string;
  row?: string;
  id: string;
  title: string;
  /**
   * Where the role is. One field, or several joined with ", " when the API
   * splits city from country the way GitHub does.
   */
  location: string | string[];
  /**
   * The key to read inside each element, when the location field is an array
   * of objects rather than of strings -- Spotify returns [{location: "..."}].
   */
  locationKey?: string;
  /** A field holding an absolute apply URL. */
  linkField?: string;
  /** Or a template, with `{id}` and `{slug}` filled from the posting. */
  linkTemplate?: string;
  slugField?: string;
  /** A unix-seconds field, where the API gives a real posted date. */
  postedSeconds?: string;
  /** Pages of this size, when the API pages at all. */
  pageSize?: number;
  /** The query parameter that carries the offset, for a paged endpoint. */
  offsetParam?: string;
};

export const CUSTOM_BOARDS: Record<string, CustomBoard> = {
  spotify: {
    endpoint: "https://api.lifeatspotify.com/wp-json/animal/v1/job/search?c={q}",
    list: "result",
    id: "id",
    title: "text",
    location: "locations",
    locationKey: "location",
    linkTemplate: "https://www.lifeatspotify.com/jobs/{id}",
  },
  github: {
    endpoint:
      "https://www.github.careers/api/jobs?keywords={q}&page=1&sortBy=relevance&descending=false&internal=false",
    list: "jobs",
    row: "data",
    id: "req_id",
    title: "title",
    location: ["location_name", "country"],
    slugField: "slug",
    linkTemplate: "https://www.github.careers/careers-home/jobs/{slug}",
    pageSize: 10,
    offsetParam: "page",
  },
  atlassian: {
    endpoint: "https://www.atlassian.com/endpoint/careers/listings",
    list: "",
    id: "id",
    title: "title",
    location: "locations",
    linkField: "applyUrl",
  },
  microsoft: {
    // Found by watching the careers page rather than guessed: the host is
    // apply.careers.microsoft.com, not the gcsservices one every guide names.
    endpoint:
      "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query={q}&location=United%20States&start=0&num=10",
    list: "data.positions",
    id: "displayJobId",
    title: "name",
    // Already normalised to "Redmond, WA, US", which is exactly what the metro
    // matcher wants -- the raw `locations` field is prose.
    location: "standardizedLocations",
    linkTemplate: "https://jobs.careers.microsoft.com/global/en/job/{id}",
    postedSeconds: "postedTs",
    // Ten, not the twenty `num` asks for: the API caps a page at ten and
    // ignores a larger `num` without saying so. A pageSize larger than the
    // real one reads the short page as the end of the list and stops early.
    pageSize: 10,
    offsetParam: "start",
  },
};

/** Walks a dotted path, returning undefined rather than throwing. */
function at(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/**
 * A location field, in any of the shapes these APIs use.
 *
 * A plain string, an array of strings, or an array of objects with the place
 * under a named key. Arrays are joined rather than reduced to one, because a
 * role open in several cities belongs to all of them and the metro matcher
 * reads the whole string.
 */
function asPlaces(value: unknown, key?: string): string {
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        key && v && typeof v === "object"
          ? asString((v as Record<string, unknown>)[key])
          : asString(v)
      )
      .filter(Boolean)
      .join("; ");
  }
  return asString(value);
}

/** One parser for every single-company API, driven by the table above. */
function parseCustom(source: JobSource, payload: unknown): JobPosting[] {
  const board = CUSTOM_BOARDS[source.provider];
  if (!board) return [];

  const rows = at(payload, board.list);
  if (!Array.isArray(rows)) return [];

  const out: JobPosting[] = [];
  for (const entry of rows) {
    const row = board.row ? at(entry, board.row) : entry;
    if (typeof row !== "object" || row === null) continue;
    const job = row as Record<string, unknown>;

    const id = asString(job[board.id]) || String(job[board.id] ?? "");
    const title = asString(job[board.title]);
    if (!id || id === "undefined" || !title) continue;

    const slug = board.slugField ? asString(job[board.slugField]) : "";
    const url = board.linkField
      ? asString(job[board.linkField])
      : (board.linkTemplate ?? "")
          .replace("{id}", encodeURIComponent(id))
          .replace("{slug}", encodeURIComponent(slug || id));

    const seconds = board.postedSeconds ? job[board.postedSeconds] : null;
    const postedAt =
      typeof seconds === "number" && seconds > 0
        ? new Date(seconds * 1000).toISOString()
        : null;

    out.push({
      id: `${source.provider}:${id}`,
      company: source.company,
      title,
      location:
        (Array.isArray(board.location)
          ? board.location
              .map((f) => asPlaces(job[f], board.locationKey))
              .filter(Boolean)
              .join(", ")
          : asPlaces(job[board.location], board.locationKey)) || "Unspecified",
      url: url || boardUrl(source),
      postedAt,
    });
  }
  return out;
}

/**
 * The URL for one page of a paged custom board, zero-indexed.
 *
 * Two APIs count differently -- GitHub numbers pages from one, Microsoft counts
 * records from zero -- and which one this is shows in the offset already in the
 * URL the registry carries: a 0 there counts records, a 1 counts pages.
 *
 * Done by scanning for the digits rather than with a regex on purpose. The
 * first version built its patterns from template strings, where a lone
 * backslash-b is a backspace and backslash-d is a bare "d", so neither pattern
 * ever matched: every request refetched page one and each paged board quietly
 * returned a single page. Nothing threw, so nothing showed it. There is no way
 * to make that mistake without a regex to escape.
 */
export function customPageUrl(
  base: string,
  board: CustomBoard,
  page: number
): string {
  if (!board.offsetParam || !board.pageSize) return base;
  const key = board.offsetParam + "=";
  const at = base.indexOf(key);
  if (at < 0) return base;

  const from = at + key.length;
  let to = from;
  while (to < base.length && base[to] >= "0" && base[to] <= "9") to += 1;

  const countsRecords = base.slice(from, to) === "0";
  const offset = countsRecords ? page * board.pageSize : page + 1;
  return base.slice(0, from) + String(offset) + base.slice(to);
}

export function parseBoard(source: JobSource, payload: unknown): JobPosting[] {
  if (source.provider in CUSTOM_BOARDS) return parseCustom(source, payload);
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
      "microsoft",
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
