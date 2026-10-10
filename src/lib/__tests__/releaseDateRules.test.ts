import { describe, it, expect } from "vitest";
import { formatReleaseDate, releaseLabel } from "../releaseDateRules";

describe("showing a release date", () => {
  it("writes the date it was given, not the day before", () => {
    expect(formatReleaseDate("1999-03-31")).toBe("Mar 31, 1999");
    expect(formatReleaseDate("2008-01-01")).toBe("Jan 1, 2008");
    expect(formatReleaseDate("2026-12-25")).toBe("Dec 25, 2026");
  });

  it("refuses what is not a date", () => {
    expect(formatReleaseDate("")).toBeNull();
    expect(formatReleaseDate(undefined)).toBeNull();
    expect(formatReleaseDate("1999")).toBeNull();
    expect(formatReleaseDate("1999-13-01")).toBeNull();
    expect(formatReleaseDate("1999-00-10")).toBeNull();
  });

  it("falls back to the year, then to nothing", () => {
    expect(releaseLabel({ releaseDate: "1999-03-31", year: "1999" })).toBe("Mar 31, 1999");
    expect(releaseLabel({ year: "1999" })).toBe("1999");
    expect(releaseLabel({ year: "" })).toBe("");
  });
});
