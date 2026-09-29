/**
 * Whether a watched board -- API board or scraped site -- is actually being
 * read. Pure; the poll records the inputs and the panel shows the verdict.
 *
 * A board that fails loudly is easy. The ones worth a badge are the quiet
 * failures: a scraper that still "succeeds" but returns nothing because the
 * page changed, or a board that has not had a good poll in hours.
 */

export type SourceHealthStatus = "ok" | "failing" | "empty" | "stale" | "unchecked" | "off";

export type SourceHealth = { status: SourceHealthStatus; detail: string };

/** Polls run every 30 minutes; several misses in a row is worth flagging. */
export const STALE_AFTER_MS = 3 * 3600_000;

export type SourceHealthInput = {
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastCount: number | null;
};

export function sourceHealth(src: SourceHealthInput, now: Date): SourceHealth {
  if (!src.enabled) return { status: "off", detail: "Polling is off" };
  if (!src.lastCheckedAt) return { status: "unchecked", detail: "Not polled yet" };
  if (src.lastError) {
    const since = src.lastSuccessAt ? ` Last worked ${ago(src.lastSuccessAt, now)}.` : " Has never worked.";
    return { status: "failing", detail: `${src.lastError}.${since}` };
  }
  if (!src.lastSuccessAt || now.getTime() - src.lastSuccessAt.getTime() > STALE_AFTER_MS) {
    return { status: "stale", detail: `No successful poll since ${src.lastSuccessAt ? ago(src.lastSuccessAt, now) : "ever"}` };
  }
  if (src.lastCount === 0) return { status: "empty", detail: "Read fine but returned no roles -- the page may have changed" };
  return { status: "ok", detail: `${src.lastCount ?? 0} roles on the last poll, ${ago(src.lastSuccessAt, now)}` };
}

/** A scraped site, as mediabox reports it in scraped-jobs.json. */
export function scrapedSiteHealth(
  site: { count: number | null; error: string | null },
  generatedAt: Date | null,
  now: Date
): SourceHealth {
  if (!generatedAt) return { status: "unchecked", detail: "No scrape report yet" };
  if (site.error) return { status: "failing", detail: site.error };
  if (now.getTime() - generatedAt.getTime() > STALE_AFTER_MS) {
    return { status: "stale", detail: `Scraper last ran ${ago(generatedAt, now)}` };
  }
  if (!site.count) return { status: "empty", detail: "Scraped fine but found no roles -- the page may have changed" };
  return { status: "ok", detail: `${site.count} roles, scraped ${ago(generatedAt, now)}` };
}

/** Problems first, so a failing board is at the top of a long list. */
export const HEALTH_RANK: Record<SourceHealthStatus, number> = {
  failing: 0,
  stale: 1,
  empty: 2,
  unchecked: 3,
  ok: 4,
  off: 5,
};

function ago(then: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
