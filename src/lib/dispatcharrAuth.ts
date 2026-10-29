/**
 * Streamy's Dispatcharr login: one access token, renewed with the refresh
 * token rather than a fresh login.
 *
 * Dispatcharr throttles logins (POST /api/accounts/token/) to 3 a minute per
 * client address, and Streamy shares that budget with mediabox's own scripts.
 * The access token lasts ~30 minutes, so logging in again on every expiry is
 * ~48 logins a day from here alone, each one a chance to land in the same
 * minute as a cron's and get throttled -- which reads as "Couldn't reach
 * Dispatcharr" on every page that asks. 2026-10-27: the stream probe's expired
 * token plus the crons' logins at :30 left a game's feed search answering
 * "busy" (mediabox-infra #261/#262 moved those scripts onto refresh tokens).
 *
 * So, as scripts/dispatcharr_auth.py does there:
 *
 *   1. the access token is used until it is near its expiry (EXPIRY_MARGIN_MS)
 *      or Dispatcharr answers 401;
 *   2. it is then renewed with the refresh token (POST
 *      /api/accounts/token/refresh/ {"refresh"} -> {"access"}), which is not
 *      throttled and lasts about a day;
 *   3. a full login happens only with no refresh token, or when the refresh
 *      is refused. A throttled login (429) backs off for its Retry-After.
 *
 * Renewals are single-flight: concurrent callers that find the token expired
 * share one renewal (see the history on fetchToken in dispatcharr.ts).
 *
 * Tokens are never logged. The fetch and clock are injectable for tests.
 */

export const LOGIN_PATH = "/api/accounts/token/";
export const REFRESH_PATH = "/api/accounts/token/refresh/";

/** An access token this close to its expiry is renewed instead of used (the Python helper's figure). */
export const EXPIRY_MARGIN_MS = 120_000;
/** Backoff after a 429 with no usable Retry-After. */
export const DEFAULT_THROTTLE_MS = 10_000;

/** The `exp` claim of a JWT in epoch ms, read without verifying; null if unreadable. */
export function jwtExpiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export type AuthOptions = {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
};

export class DispatcharrAuth {
  private access: string | null = null;
  private accessExp: number | null = null;
  private refresh: string | null = null;
  private inFlight: Promise<string | null> | null = null;
  private retryAfter = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  /** Counts, for the log line and the tests. */
  readonly stats = { logins: 0, refreshes: 0 };

  constructor(private readonly opts: AuthOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  /** A token believed good right now, renewing first if needed. Null when none can be had. */
  async token(): Promise<string | null> {
    if (this.access && !this.nearExpiry()) return this.access;
    return this.renew();
  }

  /** After a 401: the current token is dead, get another (refresh first). */
  async renewAfterRejection(rejected: string): Promise<string | null> {
    // Another caller may already have replaced it.
    if (this.access && this.access !== rejected && !this.nearExpiry()) return this.access;
    if (this.access === rejected) this.access = null;
    return this.renew();
  }

  private nearExpiry(): boolean {
    return this.accessExp != null && this.now() >= this.accessExp - EXPIRY_MARGIN_MS;
  }

  private renew(): Promise<string | null> {
    if (!this.inFlight) {
      this.inFlight = this.renewUncached().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async renewUncached(): Promise<string | null> {
    if (this.refresh) {
      const viaRefresh = await this.tryRefresh();
      if (viaRefresh) return viaRefresh;
    }
    return this.login();
  }

  private post(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
      cache: "no-store",
    });
  }

  private store(data: { access?: unknown; refresh?: unknown }): string | null {
    const access = typeof data.access === "string" && data.access ? data.access : null;
    if (!access) return null;
    this.access = access;
    this.accessExp = jwtExpiryMs(access);
    // Dispatcharr may rotate the refresh token on refresh; keep whichever is newest.
    if (typeof data.refresh === "string" && data.refresh) this.refresh = data.refresh;
    return access;
  }

  private async tryRefresh(): Promise<string | null> {
    try {
      const res = await this.post(REFRESH_PATH, { refresh: this.refresh });
      if (!res.ok) {
        // Expired or revoked: only a login gets a new one.
        this.log(`[dispatcharr] token refresh refused (HTTP ${res.status}), logging in`);
        this.refresh = null;
        return null;
      }
      const token = this.store((await res.json()) as { access?: unknown; refresh?: unknown });
      if (!token) {
        this.refresh = null;
        return null;
      }
      this.stats.refreshes += 1;
      this.log(`[dispatcharr] token renewed via refresh (${this.stats.refreshes} refreshes, ${this.stats.logins} logins since start)`);
      return token;
    } catch (err) {
      // A network blip: a login would most likely fail the same way, but the
      // refresh token is still good, so keep it for next time.
      this.log(`[dispatcharr] token refresh error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async login(): Promise<string | null> {
    if (this.now() < this.retryAfter) return null;
    try {
      const res = await this.post(LOGIN_PATH, { username: this.opts.username, password: this.opts.password });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_THROTTLE_MS;
        this.retryAfter = this.now() + waitMs;
        console.error(`[dispatcharr] login throttled, backing off ${waitMs}ms`);
        return null;
      }
      if (!res.ok) {
        // Logged rather than swallowed: a silent null is how a total auth
        // failure once showed only as "Couldn't reach Dispatcharr".
        console.error(`[dispatcharr] login failed: HTTP ${res.status}`);
        return null;
      }
      const token = this.store((await res.json()) as { access?: unknown; refresh?: unknown });
      if (token) {
        this.stats.logins += 1;
        this.log(`[dispatcharr] logged in (${this.stats.logins} logins, ${this.stats.refreshes} refreshes since start)`);
      }
      return token;
    } catch (err) {
      console.error("[dispatcharr] login error:", err instanceof Error ? err.message : err);
      return null;
    }
  }
}
