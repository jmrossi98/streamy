import { describe, it, expect } from "vitest";
import {
  GIVE_UP_AFTER_MS,
  GIVE_UP_MIN_SEARCHES,
  giveUpNotice,
  giveUpReason,
  retryTargets,
  shouldGiveUp,
  stillShown,
} from "../searchGiveUpRules";

const NOW = Date.parse("2026-10-16T14:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

const entry = (over: Partial<Parameters<typeof shouldGiveUp>[0] & object> = {}) => ({
  firstSearchedAt: daysAgo(2),
  lastSearchedAt: hoursAgo(1),
  searches: 9,
  gaveUpAt: null,
  ...over,
});

describe("shouldGiveUp", () => {
  it("gives up on a 2009 episode searched nine times over two days", () => {
    expect(shouldGiveUp(entry(), { releasedAt: new Date("2009-05-20") }, NOW)).toBe(true);
  });
  it("needs a full day of trying", () => {
    expect(shouldGiveUp(entry({ firstSearchedAt: hoursAgo(23) }), { releasedAt: new Date("2009-05-20") }, NOW)).toBe(false);
    expect(shouldGiveUp(entry({ firstSearchedAt: new Date(NOW - GIVE_UP_AFTER_MS) }), {}, NOW)).toBe(true);
  });
  it("needs real searches, so an outage does not run the clock down", () => {
    expect(shouldGiveUp(entry({ searches: GIVE_UP_MIN_SEARCHES - 1 }), {}, NOW)).toBe(false);
    expect(shouldGiveUp(entry({ searches: GIVE_UP_MIN_SEARCHES }), {}, NOW)).toBe(true);
  });
  it("keeps wanting an episode that aired this week", () => {
    expect(shouldGiveUp(entry(), { releasedAt: daysAgo(3) }, NOW)).toBe(false);
    expect(shouldGiveUp(entry(), { releasedAt: daysAgo(8) }, NOW)).toBe(true);
  });
  it("never gives up on a movie that is not out yet", () => {
    expect(shouldGiveUp(entry({ firstSearchedAt: daysAgo(40), searches: 90 }), { released: false }, NOW)).toBe(false);
  });
  it("does nothing without a ledger entry or once already given up", () => {
    expect(shouldGiveUp(null, {}, NOW)).toBe(false);
    expect(shouldGiveUp(entry({ gaveUpAt: hoursAgo(1) }), {}, NOW)).toBe(false);
  });
});

describe("wording", () => {
  it("says how long and how many", () => {
    expect(giveUpReason(entry(), NOW)).toBe("gave up after 2 days: no release found in 9 searches");
    expect(giveUpNotice(entry({ gaveUpAt: hoursAgo(1) }))).toBe(
      "Gave up after 2 days: no indexer had a usable release. Retry to search again."
    );
  });
  it("lists a give-up for three days", () => {
    expect(stillShown(entry({ gaveUpAt: daysAgo(2) }), NOW)).toBe(true);
    expect(stillShown(entry({ gaveUpAt: daysAgo(4) }), NOW)).toBe(false);
    expect(stillShown(entry(), NOW)).toBe(false);
  });
});

describe("retryTargets", () => {
  it("takes only given-up rows, episodes grouped per show", () => {
    const t = retryTargets([
      { mediaType: "show", externalId: 7, episodeId: 70, gaveUp: true },
      { mediaType: "show", externalId: 7, episodeId: 71, gaveUp: true },
      { mediaType: "show", externalId: 7, episodeId: 72 },
      { mediaType: "show", externalId: 8, episodeId: 80, gaveUp: true },
      { mediaType: "movie", externalId: 3, gaveUp: true },
      { mediaType: "movie", externalId: 4 },
    ]);
    expect(t.movies).toEqual([3]);
    expect([...t.episodes]).toEqual([[7, [70, 71]], [8, [80]]]);
  });
  it("skips a show row with no episode and repeats", () => {
    const t = retryTargets([
      { mediaType: "show", externalId: 7, episodeId: null, gaveUp: true },
      { mediaType: "show", externalId: 9, episodeId: 90, gaveUp: true },
      { mediaType: "show", externalId: 9, episodeId: 90, gaveUp: true },
    ]);
    expect([...t.episodes]).toEqual([[9, [90]]]);
  });
});
