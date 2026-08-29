/**
 * Fetching, storage and notification for watched pages.
 *
 * The decision logic -- extraction, diffing, keyword and date parsing -- is in
 * pageWatchRules.ts and is pure and unit tested. This module is the part that
 * touches the network and the database, and it stays deliberately thin so that
 * almost nothing here is logic you can only verify in production.
 *
 * Notifications are email, via the same SNS topic as the health check.
 */

import { ProxyAgent } from "undici";
import { prisma } from "@/lib/db";
import { isEgressEnabled } from "@/lib/appSettings";
import {
  describeChange,
  diffLines,
  egressProxyRequired,
  egressProxyUrl,
  extractElement,
  formatDiff,
  hashContent,
  htmlToText,
  isAllowedByRobots,
  isEgressProxied,
  matchesLocation,
  newKeywordHits,
  normalizeLines,
  parseKeywords,
  parseLocations,
  parseTourDates,
  resolveEgress,
  shouldNotify,
  userAgent,
  type ContentDiff,
} from "@/lib/pageWatchRules";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 5_000_000;
const MAX_DIFF_CHARS = 8000;

let cachedAgent: { url: string; agent: ProxyAgent } | null = null;
function proxyDispatcher(url: string): ProxyAgent {
  if (cachedAgent?.url !== url) cachedAgent = { url, agent: new ProxyAgent(url) };
  return cachedAgent.agent;
}

/**
 * Headers for every watch request: ordinary, and carrying nothing that could
 * link one visit to the next.
 *
 * Deliberately a plain, common set -- no unusual header would make the request
 * stand out in a log. It sends no Cookie and no conditional-request header
 * (If-None-Match / If-Modified-Since): echoing back a server-supplied ETag is
 * a known "supercookie", a value the site hands out and then recognises on the
 * next visit, so we never store or return one.
 */
function requestHeaders(accept: string): Record<string, string> {
  return {
    "User-Agent": userAgent(),
    Accept: accept,
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/**
 * The only fetch used for outbound watch traffic. Fail-closed: it never falls
 * back to a direct connection when a proxy is required, so a watch request can
 * never leave from this box's own IP.
 *
 * Stateless by construction: `cache: "no-store"` means no response is kept to
 * be revalidated with an ETag later, and credentials are omitted so no cookie
 * is ever sent. Each visit is therefore indistinguishable from a first one --
 * there is no thread the site can pull to tie our visits into a history.
 */
async function watchFetch(url: string, init: RequestInit): Promise<Response> {
  // The admin's runtime toggle wins: turned off, the watcher goes direct with
  // no proxy, regardless of the env config. Turned on (the default), the env
  // config decides -- proxy when set, fail-closed when required.
  const decision = (await isEgressEnabled())
    ? resolveEgress(egressProxyUrl(), egressProxyRequired())
    : ({ via: "direct" } as const);
  if (decision.via === "blocked") {
    throw new Error("Egress proxy required but PAGE_WATCH_PROXY_URL is unset — refusing to fetch");
  }
  // `dispatcher` is an undici extension to RequestInit that the global fetch
  // honours at runtime but the DOM types don't describe.
  const extra = decision.via === "proxy" ? { dispatcher: proxyDispatcher(decision.url) } : {};
  return fetch(url, {
    cache: "no-store",
    credentials: "omit",
    ...init,
    ...extra,
  } as RequestInit);
}

// Echoes back the caller's public IP. The Services panel's torrent-VPN check
// uses the same service, so the two VPN checks agree on what "our IP" means.
const IP_ECHO = "https://api.ipify.org?format=json";

export type EgressHealth =
  | { state: "direct" }
  | { state: "protected"; exitIp: string }
  | { state: "leaking"; ip: string }
  | { state: "down"; error: string };

/**
 * Verifies, live, that watch traffic actually leaves through the VPN.
 *
 * A green banner from PAGE_WATCH_PROXY_URL being set only proves the config is
 * present, not that gluetun is up and carrying traffic. This proves it: it asks
 * an IP-echo service for the exit address twice -- once directly, once through
 * the proxy -- and compares.
 *
 *  - direct    : no proxy configured; traffic leaves from this box, as the
 *                banner already says.
 *  - protected : the proxied request came back with a different IP -- the
 *                tunnel is up and carrying traffic. The exit IP is shown.
 *  - leaking   : the proxied IP equals this box's own -- the proxy is set but
 *                not actually tunnelling, which is the dangerous silent case.
 *  - down      : the proxied request failed -- gluetun is not reachable. With
 *                PAGE_WATCH_REQUIRE_PROXY on this is also what the watcher hits,
 *                so it is failing closed rather than leaking, but nothing is
 *                being watched until it recovers.
 */
export async function checkEgress(): Promise<EgressHealth> {
  // Toggled off, or no proxy configured, means traffic goes direct -- report it
  // as such rather than probing a proxy that won't be used.
  if (!(await isEgressEnabled()) || !isEgressProxied()) return { state: "direct" };

  // This box's own public IP -- a plain fetch, never through the proxy.
  let directIp: string | null = null;
  try {
    const res = await fetch(IP_ECHO, { signal: AbortSignal.timeout(8000) });
    if (res.ok) directIp = ((await res.json()) as { ip?: string }).ip ?? null;
  } catch {
    // A failure to learn our own IP isn't fatal; the exit IP is what matters.
  }

  // The exit IP as the watcher sees it -- through the proxy.
  let exitIp: string | null = null;
  let error = "";
  try {
    const res = await watchFetch(IP_ECHO, { signal: AbortSignal.timeout(8000) });
    if (res.ok) exitIp = ((await res.json()) as { ip?: string }).ip ?? null;
    else error = `proxy returned HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (!exitIp) return { state: "down", error: error || "no exit address returned" };
  if (directIp && exitIp === directIp) return { state: "leaking", ip: exitIp };
  return { state: "protected", exitIp };
}

export type CheckOutcome =
  | { ok: true; changed: boolean; summary: string; keywordHits: string[]; dateCount: number }
  | { ok: false; error: string };

function compileIgnore(pattern: string | null): RegExp[] {
  if (!pattern) return [];
  const out: RegExp[] = [];
  for (const line of pattern.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(new RegExp(trimmed));
    } catch {
      // A bad regex is a config mistake, not a reason to stop checking the
      // page -- it just doesn't filter anything. The pattern itself is not
      // logged: it can carry site-identifying terms, and logs are the one
      // place this feature is meant to reveal nothing.
      console.warn("[pageWatch] ignoring an invalid ignore pattern");
    }
  }
  return out;
}

/** Fetches a URL as text, with a timeout and a size ceiling. */
async function fetchText(url: string): Promise<string> {
  const res = await watchFetch(url, {
    headers: requestHeaders("text/html,application/xhtml+xml,text/plain"),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error(`Response too large (${length} bytes)`);

  const text = await res.text();
  // content-length is optional and can lie, so the real size is checked too.
  if (text.length > MAX_BYTES) throw new Error("Response too large");
  return text;
}

/**
 * Whether robots.txt allows fetching this URL.
 *
 * Fails open: a missing, unreachable or unparseable robots.txt means allowed.
 * A site that cannot serve robots.txt has not expressed a preference, and
 * treating that as a prohibition would make the watcher silently do nothing.
 */
export async function robotsAllows(url: string): Promise<boolean> {
  try {
    const target = new URL(url);
    // Through the same egress as the page fetch: hitting robots.txt directly
    // would leak this box's IP to the very site we are trying not to be traced
    // from, one request before the page fetch that is being protected.
    const res = await watchFetch(new URL("/robots.txt", target.origin).toString(), {
      headers: requestHeaders("text/plain"),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true;
    return isAllowedByRobots(await res.text(), target.pathname, userAgent());
  } catch (err) {
    // A required proxy being down must not become an open door: fail-closed
    // errors propagate rather than being read as "allowed".
    if (err instanceof Error && err.message.includes("Egress proxy required")) throw err;
    return true;
  }
}

type PageRow = {
  id: string;
  url: string;
  label: string;
  artist: string | null;
  selector: string | null;
  ignorePattern: string | null;
  keywords: string | null;
  contentHash: string | null;
  content: string | null;
  failureCount: number;
};

/**
 * Checks one page: fetch, extract, compare, store, notify.
 *
 * Never throws. A page that fails records its error and increments a failure
 * count, so one dead URL doesn't abort a run over every other page.
 */
export async function checkPage(page: PageRow): Promise<CheckOutcome> {
  let html: string;
  try {
    if (!(await robotsAllows(page.url))) {
      throw new Error("Blocked by robots.txt");
    }
    html = await fetchText(page.url);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.watchedPage.update({
      where: { id: page.id },
      data: {
        lastCheckedAt: new Date(),
        lastStatus: "error",
        lastError: error,
        failureCount: { increment: 1 },
      },
    });
    return { ok: false, error };
  }

  const scoped = page.selector ? (extractElement(html, page.selector) ?? html) : html;
  const lines = normalizeLines(htmlToText(scoped), compileIgnore(page.ignorePattern));
  const hash = hashContent(lines);

  const previousLines = page.content ? page.content.split("\n") : [];
  const diff: ContentDiff = diffLines(previousLines, lines);
  const changed = page.contentHash !== null && hash !== page.contentHash;
  const keywordHits = newKeywordHits(diff, parseKeywords(page.keywords));

  // Dates are replaced wholesale so the overall view reflects the page as it
  // reads now -- a removed show must disappear, not linger as if still booked.
  const dates = parseTourDates(lines, new Date().getFullYear());
  const artist = page.artist ?? page.label;

  await prisma.$transaction([
    prisma.tourDate.deleteMany({ where: { pageId: page.id } }),
    prisma.tourDate.createMany({
      data: dates.map((d) => ({
        pageId: page.id,
        artist,
        date: d.date,
        detail: d.detail,
        raw: d.raw,
      })),
    }),
    prisma.watchedPage.update({
      where: { id: page.id },
      data: {
        lastCheckedAt: new Date(),
        lastStatus: "ok",
        lastError: null,
        contentHash: hash,
        content: lines.join("\n"),
        failureCount: 0,
      },
    }),
  ]);

  const summary = describeChange(diff);

  // A change is recorded for the panel to show. No email: this feature is read
  // from the admin panel, not pushed to an inbox. The first check of a page
  // establishes a baseline and is not a change (shouldNotify handles that).
  if (shouldNotify(page.contentHash, diff)) {
    await prisma.pageChange.create({
      data: {
        pageId: page.id,
        summary,
        diff: formatDiff(diff).slice(0, MAX_DIFF_CHARS),
        keywordHits: keywordHits.length ? keywordHits.join(", ") : null,
        // Not emailed by design; kept so the column still reconciles.
        notified: false,
      },
    });
  }

  return { ok: true, changed, summary, keywordHits, dateCount: dates.length };
}

export type RunResult = {
  checked: number;
  changed: number;
  failed: number;
  notified: number;
};

/**
 * Checks every enabled page, one at a time.
 *
 * Sequential on purpose. These are a handful of pages every few hours, so
 * concurrency buys nothing measurable, and hitting one site with parallel
 * requests is how a polite watcher starts looking like a scraper.
 */
export async function runAllChecks(): Promise<RunResult> {
  const pages = await prisma.watchedPage.findMany({ where: { enabled: true } });
  const result: RunResult = { checked: 0, changed: 0, failed: 0, notified: 0 };

  for (const page of pages) {
    const outcome = await checkPage(page);
    result.checked++;
    if (!outcome.ok) result.failed++;
    else if (outcome.changed) {
      result.changed++;
      if (outcome.keywordHits.length) result.notified++;
    }
  }
  return result;
}

export type ArtistDates = {
  artist: string;
  dates: { date: string | null; detail: string; raw: string; url: string; label: string }[];
};

/**
 * The overall view: every artist and their dates, across all watched pages.
 *
 * Undated lines sort last rather than being dropped -- a listing the parser
 * couldn't date is still something worth seeing, and hiding it would make the
 * view quietly incomplete.
 */
/**
 * Location filter for the overall view. Only dates whose venue text matches one
 * of these show up, so the "all dates" view answers "who is playing near me"
 * rather than listing every city. Defaults to the DC area; override with a
 * comma-separated PAGE_WATCH_LOCATIONS, or set it empty to show everywhere.
 */
export function watchLocations(): string[] {
  const raw = process.env.PAGE_WATCH_LOCATIONS ?? "Tysons,Washington";
  return parseLocations(raw);
}

export async function getArtistDates(): Promise<ArtistDates[]> {
  const rows = await prisma.tourDate.findMany({
    include: { page: { select: { url: true, label: true } } },
    orderBy: [{ artist: "asc" }, { date: "asc" }],
  });

  const locations = watchLocations();
  const byArtist = new Map<string, ArtistDates>();
  for (const row of rows) {
    // Filter to the wanted area, matching against both the cleaned detail and
    // the original line so a city that only survives in the raw text still
    // counts.
    if (!matchesLocation(`${row.detail} ${row.raw}`, locations)) continue;

    let entry = byArtist.get(row.artist);
    if (!entry) {
      entry = { artist: row.artist, dates: [] };
      byArtist.set(row.artist, entry);
    }
    entry.dates.push({
      date: row.date,
      detail: row.detail,
      raw: row.raw,
      url: row.page.url,
      label: row.page.label,
    });
  }

  for (const entry of byArtist.values()) {
    entry.dates.sort((a, b) => {
      if (a.date === b.date) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return a.date < b.date ? -1 : 1;
    });
  }

  return [...byArtist.values()].sort((a, b) => a.artist.localeCompare(b.artist));
}

export type PageWatchSummary = {
  pages: {
    id: string;
    url: string;
    label: string;
    artist: string | null;
    keywords: string | null;
    enabled: boolean;
    lastCheckedAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    failureCount: number;
    dateCount: number;
  }[];
  recentChanges: {
    id: string;
    label: string;
    detectedAt: string;
    summary: string;
    diff: string;
    keywordHits: string | null;
  }[];
  artists: ArtistDates[];
  /** The location filter in effect on the overall dates view. */
  locations: string[];
  /** The admin's on/off toggle for routing through the VPN egress. */
  egressEnabled: boolean;
  /** Whether an egress proxy is configured at all (env). */
  egressProxied: boolean;
  /** Whether a missing proxy hard-fails the fetch rather than going direct. */
  egressEnforced: boolean;
};

/** Everything the admin panel renders, in one round trip. */
export async function getPageWatchSummary(): Promise<PageWatchSummary> {
  const [pages, changes, artists] = await Promise.all([
    prisma.watchedPage.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { dates: true } } },
    }),
    prisma.pageChange.findMany({
      orderBy: { detectedAt: "desc" },
      take: 20,
      include: { page: { select: { label: true } } },
    }),
    getArtistDates(),
  ]);

  return {
    pages: pages.map((p) => ({
      id: p.id,
      url: p.url,
      label: p.label,
      artist: p.artist,
      keywords: p.keywords,
      enabled: p.enabled,
      lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null,
      lastStatus: p.lastStatus,
      lastError: p.lastError,
      failureCount: p.failureCount,
      dateCount: p._count.dates,
    })),
    recentChanges: changes.map((c) => ({
      id: c.id,
      label: c.page.label,
      detectedAt: c.detectedAt.toISOString(),
      summary: c.summary,
      diff: c.diff,
      keywordHits: c.keywordHits,
    })),
    artists,
    locations: watchLocations(),
    egressEnabled: await isEgressEnabled(),
    egressProxied: isEgressProxied(),
    egressEnforced: egressProxyRequired(),
  };
}
