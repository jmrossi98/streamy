import { describe, expect, it } from "vitest";
import { tvdbIdFromLookup } from "../tvdbIdRules";

describe("tvdbIdFromLookup", () => {
  it("takes the TVDB id of the hit with the same TMDB id", () => {
    const hits = [
      { tmdbId: 74502, tvdbId: 320216 },
      { tmdbId: 320936, tvdbId: 482756 },
    ];
    expect(tvdbIdFromLookup(hits, "320936")).toBe(482756);
  });

  it("never falls back to a different show", () => {
    expect(tvdbIdFromLookup([{ tmdbId: 74502, tvdbId: 320216 }], "320936")).toBeNull();
  });

  it("ignores hits without a usable TVDB id", () => {
    expect(tvdbIdFromLookup([{ tmdbId: 320936, tvdbId: 0 }], "320936")).toBeNull();
    expect(tvdbIdFromLookup([{ tmdbId: 320936, tvdbId: null }], "320936")).toBeNull();
    expect(tvdbIdFromLookup([{ tmdbId: 320936 }], "320936")).toBeNull();
  });

  it("returns null for an empty lookup or a malformed id", () => {
    expect(tvdbIdFromLookup([], "320936")).toBeNull();
    expect(tvdbIdFromLookup([{ tmdbId: 0, tvdbId: 5 }], "abc")).toBeNull();
    expect(tvdbIdFromLookup([{ tmdbId: 0, tvdbId: 5 }], "0")).toBeNull();
  });
});
