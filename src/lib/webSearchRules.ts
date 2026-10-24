/**
 * The rules that keep SearXNG's upstream engines from flagging the home
 * address. Pure, so they test without a network.
 *
 * Why this exists: on 2026-10-12 (#397) search was switched off because
 * Streamy's own health check searched "ping" every ten minutes from the home
 * IP, and DuckDuckGo, Brave, Startpage and Google answered with CAPTCHAs and
 * rate limits until real searches came back empty. Brought back 2026-10-24
 * with the model choosing when to search, which makes the volume less
 * predictable than a toggle -- so every search now passes a cache, a rate
 * cap and a back-off before it reaches an engine.
 */

/** Cache lifetimes. Short for anything whose answer moves by the hour. */
export const CACHE_TTL_MS = 30 * 60_000;
export const TIME_SENSITIVE_TTL_MS = 5 * 60_000;

/** Across the whole app, not per user: the engines see one address. */
export const SEARCHES_PER_MINUTE = 6;
export const SEARCHES_PER_DAY = 200;

/** How long to leave the engines alone once they push back. */
export const BACKOFF_MS = 10 * 60_000;

/**
 * Normalised so "Bitcoin price?" and "  bitcoin   PRICE " share one cache
 * entry -- the model rephrases the same lookup across rounds and turns.
 */
export function normalizeQuery(query: string): string {
  return query
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?!.,;:]+$/, "");
}

const TIME_SENSITIVE =
  /\b(today|tonight|yesterday|tomorrow|now|currently|current|latest|recent|newest|this (week|month|year)|price|prices|pricing|cost|deal|deals|sale|sales|discount|coupon|score|scores|standings|news|headline|headlines|weather|forecast|stock|stocks|rate|rates|live|breaking|election|polls?)\b|\b(19|20)\d\d\b/i;

/** Whether an answer to this query is likely to go stale within the hour. */
export function isTimeSensitive(query: string): boolean {
  return TIME_SENSITIVE.test(query);
}

export function cacheTtlFor(query: string): number {
  return isTimeSensitive(query) ? TIME_SENSITIVE_TTL_MS : CACHE_TTL_MS;
}

export type BudgetVerdict = { ok: true } | { ok: false; retryInMs: number; reason: "minute" | "day" | "backoff" };

/**
 * A token bucket for the per-minute rate plus a UTC-day counter, with the
 * back-off folded in so callers ask one question: may I search now?
 *
 * The clock is injected so tests can step through time.
 */
export class SearchBudget {
  private tokens: number;
  private refilledAt: number;
  private day: string;
  private usedToday = 0;
  private restingUntil = 0;
  private restReason: string | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly perMinute = SEARCHES_PER_MINUTE,
    private readonly perDay = SEARCHES_PER_DAY
  ) {
    this.tokens = perMinute;
    this.refilledAt = now();
    this.day = utcDay(this.refilledAt);
  }

  private refill(t: number): void {
    const elapsed = t - this.refilledAt;
    if (elapsed > 0) {
      this.tokens = Math.min(this.perMinute, this.tokens + (elapsed * this.perMinute) / 60_000);
      this.refilledAt = t;
    }
    const day = utcDay(t);
    if (day !== this.day) {
      this.day = day;
      this.usedToday = 0;
    }
  }

  /** Takes one search from the budget, or says how long to wait. */
  take(): BudgetVerdict {
    const t = this.now();
    if (t < this.restingUntil) return { ok: false, retryInMs: this.restingUntil - t, reason: "backoff" };
    this.refill(t);
    if (this.usedToday >= this.perDay) {
      return { ok: false, retryInMs: nextUtcMidnight(t) - t, reason: "day" };
    }
    if (this.tokens < 1) {
      return { ok: false, retryInMs: Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute), reason: "minute" };
    }
    this.tokens -= 1;
    this.usedToday += 1;
    return { ok: true };
  }

  /** Engines pushed back: no searches at all for BACKOFF_MS. */
  rest(reason: string, ms = BACKOFF_MS): void {
    this.restingUntil = this.now() + ms;
    this.restReason = reason;
  }

  /** For the health panel. Null when not resting. */
  resting(): { until: number; reason: string } | null {
    return this.now() < this.restingUntil ? { until: this.restingUntil, reason: this.restReason ?? "engines pushed back" } : null;
  }

  usage(): { today: number; perDay: number } {
    this.refill(this.now());
    return { today: this.usedToday, perDay: this.perDay };
  }
}

function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function nextUtcMidnight(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** What the model is told instead of results when the budget says no. */
export function restingMessage(verdict: Exclude<BudgetVerdict, { ok: true }>): string {
  const s = Math.max(1, Math.ceil(verdict.retryInMs / 1000));
  const wait = s >= 3600 ? `${Math.ceil(s / 3600)} h` : s >= 120 ? `${Math.ceil(s / 60)} min` : `${s} s`;
  const why =
    verdict.reason === "backoff"
      ? "the search engines recently answered with CAPTCHAs or rate limits"
      : verdict.reason === "day"
        ? `today's ${SEARCHES_PER_DAY}-search allowance is used up`
        : `the ${SEARCHES_PER_MINUTE}-per-minute allowance is used up`;
  return `Search is resting to avoid being flagged (${why}). Try again in ${wait}.`;
}

/**
 * Engine errors that mean "you are being blocked", as SearXNG words them in
 * `unresponsive_engines` (e.g. "Suspended: CAPTCHA", "too many requests",
 * "HTTP error 429", "access denied" from a Cloudflare challenge).
 */
const PUSHBACK = /captcha|too many requests|\b429\b|rate.?limit|access denied|suspended/i;

export type SearxngBody = {
  results?: unknown[];
  unresponsive_engines?: unknown[];
};

/**
 * Whether this response means the engines are pushing back on us. Either an
 * outright 429 from SearXNG, or no results with most of the failing engines
 * naming a block -- one timed-out engine on a quiet query is not a reason to
 * stop searching for ten minutes.
 */
export function detectPushback(status: number, body: SearxngBody | null): string | null {
  if (status === 429) return "SearXNG answered HTTP 429";
  if (!body) return null;
  const results = Array.isArray(body.results) ? body.results : [];
  if (results.length > 0) return null;
  const engines = (Array.isArray(body.unresponsive_engines) ? body.unresponsive_engines : []).map((e) =>
    Array.isArray(e) ? { name: String(e[0] ?? "?"), reason: String(e[1] ?? "") } : { name: String(e), reason: "" }
  );
  if (engines.length === 0) return null;
  const flagged = engines.filter((e) => PUSHBACK.test(e.reason));
  if (flagged.length === 0 || flagged.length * 2 < engines.length) return null;
  return `engines blocked: ${flagged.map((e) => `${e.name} (${e.reason})`).join(", ")}`;
}

function base(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The only URL the health check may touch. SearXNG's /healthz answers from
 * the instance itself and contacts no engine -- the whole point after #397.
 */
export function searxngHealthUrl(searxngUrl: string): string {
  return `${base(searxngUrl)}/healthz`;
}

export function searxngSearchUrl(searxngUrl: string, query: string): string {
  return `${base(searxngUrl)}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;
}
