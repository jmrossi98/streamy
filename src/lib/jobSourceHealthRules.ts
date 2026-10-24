/**
 * Whether a watched board -- API board or scraped site -- is actually being
 * read. Pure; the poll records the inputs and the panel shows the verdict.
 *
 * A board that fails loudly is easy. The ones worth a badge are the quiet
 * failures: a scraper that still "succeeds" but returns nothing because the
 * page changed, or a board that has not had a good poll in hours.
 */

export type SourceHealthStatus = "ok" | "failing" | "limited" | "empty" | "stale" | "unchecked" | "off";

export type SourceHealth = { status: SourceHealthStatus; detail: string };

/** Polls run every 30 minutes; several misses in a row is worth flagging. */
export const STALE_AFTER_MS = 3 * 3600_000;

/**
 * mediabox scrapes career sites every 6 hours (crontab/root.cron in
 * mediabox-infra), so the 3-hour window above flagged every scraped site as
 * stale for half of each cycle. One missed run plus slack (2026-10-24).
 */
export const SCRAPED_STALE_AFTER_MS = 7 * 3600_000;

/** Times in the panel are Jake's local time. */
const DISPLAY_TIME_ZONE = "America/New_York";

export type SourceHealthInput = {
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastCount: number | null;
  /** Set after an HTTP 429; the board is skipped until then. */
  backoffUntil?: Date | null;
};

export function sourceHealth(
  src: SourceHealthInput,
  now: Date,
  opts: { staleAfterMs?: number } = {}
): SourceHealth {
  if (!src.enabled) return { status: "off", detail: "Polling is off" };
  // Before "unchecked" and "failing": a rate-limited board is being handled,
  // and "Can't read" would send someone looking for a broken slug.
  if (src.backoffUntil && src.backoffUntil > now) {
    return { status: "limited", detail: `Rate limited, retrying at ${clock(src.backoffUntil)}` };
  }
  if (!src.lastCheckedAt) return { status: "unchecked", detail: "Not polled yet" };
  if (src.lastError) {
    const since = src.lastSuccessAt ? ` Last worked ${ago(src.lastSuccessAt, now)}.` : " Has never worked.";
    return { status: "failing", detail: `${src.lastError}.${since}` };
  }
  if (!src.lastSuccessAt || now.getTime() - src.lastSuccessAt.getTime() > (opts.staleAfterMs ?? STALE_AFTER_MS)) {
    return { status: "stale", detail: `No successful poll since ${src.lastSuccessAt ? ago(src.lastSuccessAt, now) : "ever"}` };
  }
  if (src.lastCount === 0) return { status: "empty", detail: "Read fine but returned no roles -- the page may have changed" };
  return { status: "ok", detail: `${src.lastCount ?? 0} roles on the last poll, ${ago(src.lastSuccessAt, now)}` };
}

/** Problems first, so a failing board is at the top of a long list. */
export const HEALTH_RANK: Record<SourceHealthStatus, number> = {
  failing: 0,
  stale: 1,
  empty: 2,
  limited: 3,
  unchecked: 4,
  ok: 5,
  off: 6,
};

/** "15:40", 24-hour, in Eastern time. */
function clock(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

function ago(then: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
