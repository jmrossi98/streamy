import { describe, it, expect } from "vitest";
import {
  easterSunday,
  holidayNow,
  holidayOn,
  holidayScore,
  pickHolidayTitles,
  thanksgivingDay,
} from "../holidayRules";

const slug = (y: number, m: number, d: number) => holidayOn(y, m, d)?.slug ?? null;

describe("the holiday calendar", () => {
  it("is Halloween for all of October and nothing the day before", () => {
    expect(slug(2026, 9, 30)).toBeNull();
    expect(slug(2026, 10, 1)).toBe("halloween");
    expect(slug(2026, 10, 31)).toBe("halloween");
  });

  it("hands November to Thanksgiving, then Christmas the morning after", () => {
    expect(thanksgivingDay(2026)).toBe(26);
    expect(thanksgivingDay(2023)).toBe(23);
    expect(slug(2026, 11, 1)).toBe("thanksgiving");
    expect(slug(2026, 11, 26)).toBe("thanksgiving");
    expect(slug(2026, 11, 27)).toBe("christmas");
    expect(slug(2026, 12, 25)).toBe("christmas");
  });

  it("carries New Year's across the turn of the year", () => {
    expect(slug(2026, 12, 26)).toBe("new-years");
    expect(slug(2027, 1, 1)).toBe("new-years");
    expect(slug(2027, 1, 2)).toBeNull();
  });

  it("finds the moving and the fixed spring holidays", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(slug(2026, 3, 28)).toBeNull();
    expect(slug(2026, 3, 29)).toBe("easter");
    expect(slug(2026, 4, 5)).toBe("easter");
    expect(slug(2026, 4, 6)).toBeNull();
    expect(slug(2026, 2, 14)).toBe("valentines");
    expect(slug(2026, 3, 17)).toBe("st-patricks");
    expect(slug(2026, 7, 4)).toBe("fourth-of-july");
  });

  it("has no holiday in the gaps", () => {
    for (const [m, d] of [[1, 15], [5, 20], [8, 10], [9, 15]]) expect(slug(2026, m, d)).toBeNull();
  });

  it("reads the date where the household is, not where the server is", () => {
    // 02:00 UTC on November 1st is still Halloween night in New York.
    const lateHalloween = new Date("2026-11-01T02:00:00Z");
    expect(holidayNow(lateHalloween)?.slug).toBe("halloween");
    expect(holidayNow(lateHalloween, "UTC")?.slug).toBe("thanksgiving");
  });
});

describe("matching titles to a holiday", () => {
  const halloween = holidayOn(2026, 10, 15)!;
  const christmas = holidayOn(2026, 12, 15)!;

  it("scores a title about the holiday above one that merely suits it", () => {
    expect(holidayScore(halloween, { keywords: ["Halloween", "small town"], genres: ["Family"] })).toBe(2);
    expect(holidayScore(halloween, { keywords: ["haunted house"], genres: ["Comedy"] })).toBe(1);
    expect(holidayScore(halloween, { keywords: [], genres: ["Horror"] })).toBe(1);
    expect(holidayScore(halloween, { keywords: ["road trip"], genres: ["Comedy"] })).toBe(0);
  });

  it("matches whole words, across punctuation", () => {
    expect(holidayScore(halloween, { keywords: ["switchblade"], genres: [] })).toBe(0);
    expect(holidayScore(halloween, { keywords: ["witch hunt"], genres: [] })).toBe(1);
    expect(holidayScore(halloween, { keywords: ["jack o lantern"], genres: [] })).toBe(2);
    expect(holidayScore(christmas, { keywords: ["christmas eve"], genres: [] })).toBe(2);
  });

  it("does not let a genre stand in for a holiday that names none", () => {
    expect(holidayScore(christmas, { keywords: ["winter"], genres: ["Family", "Comedy"] })).toBe(0);
  });

  it("orders the row: about the holiday first, then by popularity", () => {
    const titles = [
      { id: "slasher", keywords: [], genres: ["Horror"], popularity: 90 },
      { id: "drama", keywords: ["divorce"], genres: ["Drama"], popularity: 99 },
      { id: "hocus", keywords: ["halloween", "witch"], genres: ["Family"], popularity: 20 },
      { id: "town", keywords: ["halloween"], genres: ["Family"], popularity: 40 },
      { id: "ghosts", keywords: ["ghost"], genres: ["Comedy"], popularity: 10 },
    ];
    expect(pickHolidayTitles(halloween, titles).map((t) => t.id)).toEqual(["town", "hocus", "slasher", "ghosts"]);
  });
});
