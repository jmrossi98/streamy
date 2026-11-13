import { describe, expect, it } from "vitest";
import { upcomingStartLabel } from "../fixtureTimeRules";

// Built from local parts so the answers hold in any test machine's time zone.
const now = new Date(2026, 10, 13, 13, 26); // Fri 13 Nov 2026, 1:26 PM local
const iso = (d: Date) => d.toISOString();
// Newer ICU puts a narrow no-break space before AM/PM.
const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null;

describe("upcomingStartLabel", () => {
  it("is just the time for a game later today", () => {
    expect(plain(upcomingStartLabel(iso(new Date(2026, 10, 13, 19, 0)), now, "en-US"))).toBe("7:00 PM");
  });

  it("adds the day for a game on another day", () => {
    expect(plain(upcomingStartLabel(iso(new Date(2026, 10, 14, 0, 30)), now, "en-US"))).toBe("Sat 12:30 AM");
  });

  it("is null without a usable start time", () => {
    expect(upcomingStartLabel(null, now)).toBeNull();
    expect(upcomingStartLabel("not a date", now)).toBeNull();
  });
});
