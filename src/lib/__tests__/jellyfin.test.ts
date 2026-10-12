import { describe, it, expect } from "vitest";
import { matchesEpisode, matchesTmdbId, isPlayable, type JellyfinItem } from "../jellyfin";

// Regression: Jellyfin's AnyProviderIdEquals filter is silently ignored on
// this server version -- it returned the whole library regardless of the id
// passed, so every title resolved to whichever movie happened to be present.
// The Dark Knight showed "Watch now" and would have played The Fly. Matching
// happens in our own code now, so it has to be exact.
describe("matchesTmdbId", () => {
  const theFly: JellyfinItem = {
    Id: "abc",
    ProviderIds: { Imdb: "tt0091064", Tmdb: "9426" },
    LocationType: "FileSystem",
  };

  it("matches the movie whose TMDB id was asked for", () => {
    expect(matchesTmdbId(theFly, "9426")).toBe(true);
  });

  it("does not match a different movie's TMDB id", () => {
    // 155 is The Dark Knight -- this is the exact case that regressed.
    expect(matchesTmdbId(theFly, "155")).toBe(false);
  });

  it("does not match an item with no provider ids", () => {
    expect(matchesTmdbId({ Id: "x" }, "9426")).toBe(false);
  });

  it("does not confuse an IMDb id for a TMDB id", () => {
    expect(matchesTmdbId(theFly, "tt0091064")).toBe(false);
  });

  it("tolerates casing differences in the provider key", () => {
    expect(matchesTmdbId({ Id: "y", ProviderIds: { tmdb: "9426" } }, "9426")).toBe(true);
  });

  it("compares ids exactly rather than by prefix", () => {
    // "94" must not match "9426".
    expect(matchesTmdbId(theFly, "94")).toBe(false);
  });
});

describe("isPlayable", () => {
  // Radarr creates the movie folder when a title is added, and Jellyfin
  // scans that empty folder into a metadata-only stub. Treating those as
  // playable offered Play on films that hadn't downloaded.
  it("accepts an item backed by a real file", () => {
    expect(isPlayable({ Id: "a", LocationType: "FileSystem" })).toBe(true);
  });

  it("rejects a virtual, metadata-only stub", () => {
    expect(isPlayable({ Id: "a", LocationType: "Virtual" })).toBe(false);
  });

  it("rejects an item with no location at all", () => {
    expect(isPlayable({ Id: "a" })).toBe(false);
  });
});

// Regression: the season filter was sent under a name Jellyfin ignores, so the
// whole show came back and the first "episode 1" won. The Real Housewives of
// Potomac S11 E1 played S1 E1.
describe("matchesEpisode", () => {
  const s1e1: JellyfinItem = { Id: "a", ParentIndexNumber: 1, IndexNumber: 1 };
  const s11e1: JellyfinItem = { Id: "b", ParentIndexNumber: 11, IndexNumber: 1 };

  it("picks the episode from the season asked for, not the first with that number", () => {
    expect([s1e1, s11e1].find((e) => matchesEpisode(e, 11, 1))?.Id).toBe("b");
  });

  it("does not match an item with no season number", () => {
    expect(matchesEpisode({ Id: "c", IndexNumber: 1 }, 1, 1)).toBe(false);
  });
});
