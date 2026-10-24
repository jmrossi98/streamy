/**
 * Per-board decisions the poll makes: rate-limit back-off, silent seeding, the
 * custom (scraped) companies, and the order rows appear in the panel. Pure;
 * lib/jobPostings.ts applies them.
 */
import { HEALTH_RANK, type SourceHealthStatus } from "./jobSourceHealthRules";

/**
 * The provider name for a company mediabox scrapes from its career site
 * (scripts/job-scrape.py in mediabox-infra). Not a JobProvider: Streamy never
 * fetches these itself, it only reads the scraper's report. Posting ids were
 * already `scraped:<company>:<id>`, so the row's slug is the company name.
 */
export const SCRAPED_PROVIDER = "scraped";

export function isScrapedProvider(provider: string): boolean {
  return provider === SCRAPED_PROVIDER;
}

// ------------------------------------------------------------- Back-off

const HOUR = 3600_000;
export const BACKOFF_BASE_MS = HOUR;
export const BACKOFF_MAX_MS = 12 * HOUR;

/** The fetchers throw `HTTP <status>`; 429 is the one that asks us to wait. */
export function isRateLimitError(error: string | null | undefined): boolean {
  return /\bHTTP 429\b/.test(error ?? "");
}

/**
 * How long to skip a board after its `streak`th consecutive 429: 1h, 2h, 4h,
 * 8h, then 12h for good. Microsoft began answering 429 on 2026-10-24; polling
 * it every 30 minutes regardless just keeps the limit tripped.
 */
export function backoffDelayMs(streak: number): number {
  const n = Math.max(1, Math.floor(streak));
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

/** The back-off state to store after a poll of this board. */
export function nextBackoff(
  result: { error?: string | null },
  previousStreak: number,
  now: Date
): { backoffStreak: number; backoffUntil: Date | null } {
  if (!isRateLimitError(result.error)) {
    // Any other outcome ends the streak. A different error is reported as
    // "Can't read"; backing off on it would only hide it for longer.
    return { backoffStreak: 0, backoffUntil: null };
  }
  const backoffStreak = previousStreak + 1;
  return { backoffStreak, backoffUntil: new Date(now.getTime() + backoffDelayMs(backoffStreak)) };
}

/** Whether to skip this board on the poll running at `now`. */
export function isBackedOff(src: { backoffUntil: Date | null }, now: Date): boolean {
  return src.backoffUntil !== null && src.backoffUntil > now;
}

// --------------------------------------------------------- Silent seeding

/**
 * Whether postings this board turns up for the first time on this poll are
 * stamped notified without an email.
 *
 * True until the board has had one successful poll (seededAt is set then).
 * A new board, or one repointed to a different provider, returns its whole
 * backlog on that first poll and every role is "new" to us. On 2026-10-24 six
 * boards were repointed at once, which would otherwise have emailed several
 * hundred roles. Postings the board adds after that first poll are announced
 * as usual.
 */
export function seedsSilently(src: { seededAt: Date | null }): boolean {
  return src.seededAt === null;
}

/**
 * Whether turning Poll back on should make the next poll seed silently.
 *
 * Only once the board's postings could have aged out: they are deleted 72h
 * after they were last seen (STALE_AFTER_HOURS in jobPostings.ts), and a
 * deleted posting found again looks new. Before that they are still in the
 * table, so re-enabling announces only what is genuinely new.
 */
export function reseedOnEnable(
  src: { lastSuccessAt: Date | null },
  now: Date,
  staleAfterHours: number
): boolean {
  if (!src.lastSuccessAt) return true;
  return now.getTime() - src.lastSuccessAt.getTime() >= staleAfterHours * HOUR;
}

/**
 * seededAt for a scraped company seen in the report for the first time.
 *
 * The five sites scraped before 2026-10-24 already have their postings stored
 * and announced, so their rows start seeded; anything the scraper adds later
 * seeds silently like a newly added board.
 */
export function scrapedRowSeededAt(hasStoredPostings: boolean, now: Date): Date | null {
  return hasStoredPostings ? now : null;
}

// ------------------------------------------------------ Custom companies

export type ScrapeConfigRow = { provider: string; slug: string; enabled: boolean };

/**
 * What mediabox's scraper is told: which companies to scrape. Keyed by the
 * scraper's own company names. A company missing here (a site added to the
 * scraper since Streamy last saw a report) is scraped, so a new site never
 * waits for Streamy to learn about it.
 */
export function scrapeConfig(rows: ScrapeConfigRow[]): { sites: { company: string; enabled: boolean }[] } {
  return {
    sites: rows
      .filter((r) => isScrapedProvider(r.provider))
      .map((r) => ({ company: r.slug, enabled: r.enabled }))
      .sort((a, b) => a.company.localeCompare(b.company)),
  };
}

/**
 * Drops postings from scraped companies whose Poll is off.
 *
 * The scraper skips them too, but it runs every 6 hours and fails open (it
 * scrapes everything if it cannot reach Streamy), so this is what makes the
 * switch take effect on the very next poll.
 */
export function filterScrapedByPoll<P extends { company: string }>(
  postings: P[],
  rows: ScrapeConfigRow[]
): P[] {
  const off = new Set(rows.filter((r) => isScrapedProvider(r.provider) && !r.enabled).map((r) => r.slug));
  return postings.filter((p) => !off.has(p.company));
}

// ------------------------------------------------------------ Panel rows

/**
 * One list for API boards and scraped companies: problems first (by health),
 * then alphabetical, so a board needing attention is at the top of eighty.
 */
export function sortSourceRows<R extends { company: string; health: { status: SourceHealthStatus } }>(rows: R[]): R[] {
  return [...rows].sort(
    (a, b) =>
      HEALTH_RANK[a.health.status] - HEALTH_RANK[b.health.status] ||
      a.company.localeCompare(b.company, undefined, { sensitivity: "base" })
  );
}
