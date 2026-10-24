import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  filterScrapedByPoll,
  isBackedOff,
  isRateLimitError,
  nextBackoff,
  reseedOnEnable,
  scrapeConfig,
  scrapedRowSeededAt,
  seedsSilently,
  sortSourceRows,
} from "../jobBoardRules";

const now = new Date("2026-10-24T15:00:00Z");
const HOUR = 3600_000;

describe("rate-limit back-off", () => {
  it("recognises a 429 and nothing else", () => {
    expect(isRateLimitError("HTTP 429")).toBe(true);
    expect(isRateLimitError("HTTP 404")).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
  it("doubles from an hour and caps at twelve", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffDelayMs(n) / HOUR)).toEqual([1, 2, 4, 8, 12, 12]);
  });
  it("grows the streak on each 429 and clears it on anything else", () => {
    const first = nextBackoff({ error: "HTTP 429" }, 0, now);
    expect(first.backoffStreak).toBe(1);
    expect(first.backoffUntil?.getTime()).toBe(now.getTime() + HOUR);
    const third = nextBackoff({ error: "HTTP 429" }, 2, now);
    expect(third.backoffUntil?.getTime()).toBe(now.getTime() + 4 * HOUR);
    expect(nextBackoff({}, 4, now)).toEqual({ backoffStreak: 0, backoffUntil: null });
    expect(nextBackoff({ error: "HTTP 500" }, 4, now)).toEqual({ backoffStreak: 0, backoffUntil: null });
  });
  it("skips a board only until its back-off ends", () => {
    expect(isBackedOff({ backoffUntil: new Date(now.getTime() + 1) }, now)).toBe(true);
    expect(isBackedOff({ backoffUntil: now }, now)).toBe(false);
    expect(isBackedOff({ backoffUntil: null }, now)).toBe(false);
  });
});

describe("silent seeding", () => {
  it("seeds silently until the board's first good poll", () => {
    expect(seedsSilently({ seededAt: null })).toBe(true);
    expect(seedsSilently({ seededAt: now })).toBe(false);
  });
  it("re-seeds a re-enabled board only once its postings could have aged out", () => {
    expect(reseedOnEnable({ lastSuccessAt: new Date(now.getTime() - 10 * HOUR) }, now, 72)).toBe(false);
    expect(reseedOnEnable({ lastSuccessAt: new Date(now.getTime() - 72 * HOUR) }, now, 72)).toBe(true);
    expect(reseedOnEnable({ lastSuccessAt: null }, now, 72)).toBe(true);
  });
  it("starts a scraped company seeded only if its postings are already stored", () => {
    expect(scrapedRowSeededAt(true, now)).toEqual(now);
    expect(scrapedRowSeededAt(false, now)).toBeNull();
  });
});

describe("custom (scraped) companies", () => {
  const rows = [
    { provider: "scraped", slug: "Meta", enabled: true },
    { provider: "scraped", slug: "Apple", enabled: false },
    { provider: "greenhouse", slug: "stripe", enabled: false },
  ];
  it("tells the scraper which sites are on, ignoring API boards", () => {
    expect(scrapeConfig(rows)).toEqual({
      sites: [
        { company: "Apple", enabled: false },
        { company: "Meta", enabled: true },
      ],
    });
  });
  it("drops postings from scraped companies with Poll off", () => {
    const postings = [{ company: "Meta" }, { company: "Apple" }, { company: "Bloomberg" }, { company: "stripe" }];
    expect(filterScrapedByPoll(postings, rows).map((p) => p.company)).toEqual(["Meta", "Bloomberg", "stripe"]);
  });
});

describe("sortSourceRows", () => {
  it("puts problems first, then sorts by company", () => {
    const row = (company: string, status: "ok" | "failing" | "limited" | "off") => ({
      company,
      health: { status, detail: "" },
    });
    const sorted = sortSourceRows([row("b", "ok"), row("Meta", "off"), row("a", "ok"), row("z", "failing"), row("m", "limited")]);
    expect(sorted.map((r) => r.company)).toEqual(["z", "m", "a", "b", "Meta"]);
  });
});
