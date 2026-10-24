import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BACKOFF_MS,
  cacheTtlFor,
  CACHE_TTL_MS,
  detectPushback,
  isTimeSensitive,
  normalizeQuery,
  restingMessage,
  SearchBudget,
  SEARCHES_PER_DAY,
  SEARCHES_PER_MINUTE,
  searxngHealthUrl,
  searxngSearchUrl,
  TIME_SENSITIVE_TTL_MS,
} from "../webSearchRules";

describe("normalizeQuery", () => {
  it("folds case, spacing, quotes and trailing punctuation into one key", () => {
    expect(normalizeQuery('  Bitcoin   PRICE?! ')).toBe("bitcoin price");
    expect(normalizeQuery('"best budget app"')).toBe("best budget app");
    expect(normalizeQuery("Bitcoin price")).toBe(normalizeQuery("bitcoin  price."));
  });
});

describe("cache TTL", () => {
  it("is 30 min for settled questions", () => {
    expect(cacheTtlFor("who wrote the republic")).toBe(CACHE_TTL_MS);
    expect(CACHE_TTL_MS).toBe(30 * 60_000);
  });

  it("is 5 min for time-sensitive ones", () => {
    for (const q of ["news today", "latest iphone", "rtx 5070 price", "ps5 deal", "yankees score", "tax brackets 2026", "election polls"]) {
      expect(isTimeSensitive(q), q).toBe(true);
      expect(cacheTtlFor(q)).toBe(TIME_SENSITIVE_TTL_MS);
    }
    expect(TIME_SENSITIVE_TTL_MS).toBe(5 * 60_000);
  });
});

describe("SearchBudget", () => {
  const clock = (start = Date.UTC(2026, 9, 24, 12)) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it(`allows ${SEARCHES_PER_MINUTE} a minute, then says how long to wait`, () => {
    const c = clock();
    const b = new SearchBudget(c.now);
    for (let i = 0; i < SEARCHES_PER_MINUTE; i++) expect(b.take().ok).toBe(true);
    const no = b.take();
    expect(no.ok).toBe(false);
    if (!no.ok) {
      expect(no.reason).toBe("minute");
      expect(no.retryInMs).toBeGreaterThan(0);
      expect(no.retryInMs).toBeLessThanOrEqual(10_000);
    }
    c.advance(10_000);
    expect(b.take().ok).toBe(true);
  });

  it(`stops at ${SEARCHES_PER_DAY} a day and resets at UTC midnight`, () => {
    const c = clock(Date.UTC(2026, 9, 24, 0, 0));
    const b = new SearchBudget(c.now);
    let ok = 0;
    for (let i = 0; i < 400; i++) {
      if (b.take().ok) ok++;
      c.advance(11_000);
    }
    expect(ok).toBe(SEARCHES_PER_DAY);
    const no = b.take();
    expect(!no.ok && no.reason).toBe("day");
    c.advance(24 * 3600_000);
    expect(b.take().ok).toBe(true);
  });

  it("refuses everything for ten minutes after a back-off", () => {
    const c = clock();
    const b = new SearchBudget(c.now);
    b.rest("engines blocked");
    const no = b.take();
    expect(!no.ok && no.reason).toBe("backoff");
    expect(b.resting()?.reason).toBe("engines blocked");
    c.advance(BACKOFF_MS - 1);
    expect(b.take().ok).toBe(false);
    c.advance(1);
    expect(b.take().ok).toBe(true);
    expect(b.resting()).toBeNull();
  });

  it("explains a refusal in words the model can pass on", () => {
    expect(restingMessage({ ok: false, reason: "minute", retryInMs: 9_500 })).toMatch(
      /resting to avoid being flagged.*try again in 10 s/i
    );
    expect(restingMessage({ ok: false, reason: "backoff", retryInMs: BACKOFF_MS })).toMatch(/CAPTCHAs.*10 min/);
  });
});

describe("detectPushback", () => {
  it("backs off on an HTTP 429", () => {
    expect(detectPushback(429, null)).toMatch(/429/);
  });

  it("backs off when most failing engines name a block and nothing came back", () => {
    const body = {
      results: [],
      unresponsive_engines: [
        ["duckduckgo", "CAPTCHA"],
        ["brave", "too many requests"],
        ["startpage", "timeout"],
      ],
    };
    expect(detectPushback(200, body)).toMatch(/duckduckgo.*brave/);
  });

  it("does not back off for a timeout, or when results still arrived", () => {
    expect(detectPushback(200, { results: [], unresponsive_engines: [["google", "timeout"]] })).toBeNull();
    expect(
      detectPushback(200, { results: [{ title: "x" }], unresponsive_engines: [["duckduckgo", "CAPTCHA"]] })
    ).toBeNull();
    expect(detectPushback(200, { results: [] })).toBeNull();
  });

  it("does not back off when only a minority of failures are blocks", () => {
    const body = {
      results: [],
      unresponsive_engines: [["a", "CAPTCHA"], ["b", "timeout"], ["c", "timeout"]],
    };
    expect(detectPushback(200, body)).toBeNull();
  });
});

describe("SearXNG URLs", () => {
  // The #397 regression guard: the health check must never search.
  it("health checks /healthz, which contacts no engine", () => {
    expect(searxngHealthUrl("http://100.84.77.56:8888/")).toBe("http://100.84.77.56:8888/healthz");
  });

  it("keeps safesearch on for real searches", () => {
    expect(searxngSearchUrl("http://h:8888", "a b")).toBe("http://h:8888/search?q=a%20b&format=json&safesearch=1");
  });

  it("nothing outside webSearch builds a SearXNG search URL", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/webSearch(Rules)?\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
          const src = readFileSync(p, "utf8");
          if (/SEARXNG_URL/.test(src) && /\/search\?/.test(src)) offenders.push(p);
          if (/searxngSearchUrl|searchWeb\(/.test(src) && /serviceStatus|healthProbes|securityChecks|cron/i.test(p)) offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    const status = readFileSync(join(root, "lib", "serviceStatus.ts"), "utf8");
    expect(status).toMatch(/probe\(searxngHealthUrl\(/);
  });
});
