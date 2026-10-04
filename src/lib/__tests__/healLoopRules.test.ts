import { describe, it, expect } from "vitest";
import {
  decideHeal,
  healScope,
  MAX_REPLACEMENTS_PER_DAY,
  repeatOffenders,
  replacementsToday,
  type Replacement,
} from "../healLoopRules";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000);

function row(over: Partial<Replacement> = {}): Replacement {
  return {
    mediaType: "movie",
    externalId: 85,
    releaseTitle: "Dances.with.Wolves.1990.DC.Kevin.Costner.2160p.HDR.DTS.mkv",
    downloadId: "489B73E195CB6EF8E013E452812DA5891715C275",
    createdAt: hoursAgo(1),
    ...over,
  };
}

describe("repeatOffenders", () => {
  it("keeps a release blocked once it has been dropped twice in a week", () => {
    // The same torrent, re-grabbed and dropped again: matched by hash even
    // when the queue named it differently the second time.
    const rows = [row({ createdAt: hoursAgo(30) }), row({ releaseTitle: "489b73e195cb6ef8e013e452812da5891715c275", createdAt: hoursAgo(2) })];
    expect(repeatOffenders(rows, NOW)).toHaveLength(1);
  });

  it("matches usenet re-grabs by name, since each grab gets a new id", () => {
    const rows = [
      row({ releaseTitle: "Cape.Fear.1991.1080p.BluRay-iVy", downloadId: "nzo_a", createdAt: hoursAgo(5) }),
      row({ releaseTitle: "Cape Fear 1991 1080p BluRay iVy", downloadId: "nzo_b", createdAt: hoursAgo(1) }),
    ];
    expect(repeatOffenders(rows, NOW)).toHaveLength(1);
  });

  it("lets a release dropped once, or long ago, expire as usual", () => {
    expect(repeatOffenders([row()], NOW)).toEqual([]);
    expect(repeatOffenders([row({ createdAt: hoursAgo(24 * 8) }), row()], NOW)).toEqual([]);
  });
});

describe("replacementsToday", () => {
  it("counts only this title, and only the last day", () => {
    const rows = [
      row(),
      row({ releaseTitle: "another", downloadId: "x" }),
      row({ createdAt: hoursAgo(30) }),
      row({ externalId: 86 }),
      row({ mediaType: "episode" }),
    ];
    expect(replacementsToday(rows, { mediaType: "movie", externalId: 85 }, NOW)).toBe(2);
  });
});

describe("healScope", () => {
  it("counts an episode on its own, not against its whole series", () => {
    expect(healScope("show", { externalId: 19, episodeId: 1551 })).toEqual({ mediaType: "episode", externalId: 1551 });
    expect(healScope("show", { externalId: 19 })).toEqual({ mediaType: "show", externalId: 19 });
    expect(healScope("movie", { externalId: 85 })).toEqual({ mediaType: "movie", externalId: 85 });
  });
});

describe("decideHeal", () => {
  it("replaces until the daily limit", () => {
    expect(decideHeal(0, false)).toBe("replace");
    expect(decideHeal(MAX_REPLACEMENTS_PER_DAY - 1, true)).toBe("replace");
  });

  it("past the limit, leaves a stalled release to finish and only clears one that cannot", () => {
    expect(decideHeal(MAX_REPLACEMENTS_PER_DAY, false)).toBe("leave");
    expect(decideHeal(MAX_REPLACEMENTS_PER_DAY, true)).toBe("dropOnly");
  });
});
