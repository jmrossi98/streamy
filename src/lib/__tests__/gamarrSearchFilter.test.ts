import { describe, it, expect } from "vitest";
import { looksLikeNonGameRelease, isLikelyNonGameResult, dedupeIdenticalResults } from "../gamarr";
import type { GameSearchResult } from "../gamarr";

// Every case here is a real result from a live "spyro" search, not a
// synthetic example -- gamarr's own search fans out to general torrent
// trackers, several of which don't respect Torznab category filtering
// server-side, so a game search there returned movies, TV episodes, and a
// jazz fusion band mixed in with real games. This locks in the filter that
// exists specifically because of that live result set.
describe("looksLikeNonGameRelease", () => {
  it("flags a movie rip mistaken for a game hit", () => {
    expect(looksLikeNonGameRelease("Contagion.2002.DVDRip.XviD.AC3.SweSub-Spyro")).toBe(true);
  });

  it("flags a TV episode (release-group name happened to match the query)", () => {
    expect(
      looksLikeNonGameRelease("Millennium.1996.DVDRip.XviD.AC3.SweSub.S01-E16-18-Spyro")
    ).toBe(true);
  });

  it("flags a music release (Spyro Gyra, a jazz fusion band -- gamarr's own top-scored result)", () => {
    expect(looksLikeNonGameRelease("Spyro Gyra   Jubilee (2024) [24Bit 96kHz] FLAC [PMEDIA]")).toBe(
      true
    );
  });

  it("flags a soundtrack rip", () => {
    expect(
      looksLikeNonGameRelease("(Score, Unofficial, Gamerip) Spyro (Complete Soundtrack) (by Stewart Copeland)")
    ).toBe(true);
  });

  it("does not flag a real PS1 disc image", () => {
    expect(looksLikeNonGameRelease("PSX - Spyro the dragon 1-2-3  [3 CD - PAL - MultiLanguage 5] [TNT]")).toBe(
      false
    );
  });

  it("does not flag a real Vimm's Lair listing", () => {
    expect(looksLikeNonGameRelease("Crash Bash & Spyro: Year of the Dragon")).toBe(false);
  });

  it("does not flag a real scene-group game repack", () => {
    expect(looksLikeNonGameRelease("Spyro Reignited Trilogy-HOODLUM")).toBe(false);
  });

  it("does not flag a real console game with region/format tags", () => {
    expect(looksLikeNonGameRelease("Spyro the Dragon PSX (US NTSC)")).toBe(false);
    expect(looksLikeNonGameRelease("Legend of Spyro - Dawn of the Dragon [WBFS] RO8E7D {NTSC} wiiGM")).toBe(
      false
    );
  });
});

// isLikelyNonGameResult is the actual filter searchGames() applies -- it
// layers a second signal (platform + a console/disc-image marker) on top of
// looksLikeNonGameRelease, since plenty of the live false positives (P2P
// music-scene releases, "Artist-Title-WEB-YYYY-GROUP") carry none of that
// function's tag patterns at all.
describe("isLikelyNonGameResult", () => {
  it("flags a music-scene release with no audio-format tag in the title", () => {
    // Real result for a live "spyro" search -- no FLAC/MP3/etc for
    // looksLikeNonGameRelease to catch, platform "Unknown", no ROM marker.
    expect(
      isLikelyNonGameResult({ title: "Rick Arter-Spyro-WEB-2024-AFO", platform: "Unknown", sourceType: "torrent" })
    ).toBe(true);
  });

  it("trusts a DDL source (Vimm's Lair) regardless of platform or title shape", () => {
    // Real Vimm's Lair listing: no console tag in the title, and gamarr
    // reports no platform for it either -- but Vimm's is a single-purpose
    // ROM archive incapable of returning a non-game result in the first
    // place, unlike a general torrent tracker.
    expect(
      isLikelyNonGameResult({
        title: "Crash & Spyro Super Pack Volume 1",
        platform: "Unknown",
        sourceType: "ddl",
      })
    ).toBe(false);
  });

  it("flags a stub result even from a trusted DDL source", () => {
    // Real result: gamarr's Vimm's Lair driver returned ten identical "9"
    // titles (guid vault/999999) for a live search -- a placeholder, not a
    // real listing, and the DDL trust rule alone would otherwise let it
    // through.
    expect(isLikelyNonGameResult({ title: "9", platform: "Unknown", sourceType: "ddl" })).toBe(true);
  });

  it("keeps a torrent result once it has either a real platform or a ROM marker", () => {
    expect(
      isLikelyNonGameResult({
        title: "Spyro Reignited Trilogy-HOODLUM",
        platform: "Switch",
        sourceType: "torrent",
      })
    ).toBe(false);
    expect(
      isLikelyNonGameResult({
        title: "PSX - Spyro the dragon 1-2-3 [3 CD - PAL]",
        platform: "Unknown",
        sourceType: "torrent",
      })
    ).toBe(false);
  });
});

describe("dedupeIdenticalResults", () => {
  function result(over: Partial<GameSearchResult>): GameSearchResult {
    return {
      title: "Final Fantasy VII (PS1)",
      sizeBytes: null,
      sizeHuman: null,
      seeders: null,
      indexer: "Vimm's Lair",
      platform: "PS1",
      platformSlug: "psx",
      sourceType: "ddl",
      safetyScore: null,
      score: 80,
      confidence: null,
      inLibrary: false,
      guid: "https://vimm.net/vault/50601",
      ...over,
    };
  }

  it("collapses the real Vimm duplicate set to one row", () => {
    // Verbatim from a live "final fantasy vii" search: six results with a
    // byte-identical label, differing only by vault id.
    const rows = ["50601", "50602", "50603", "50604", "50843", "2826"].map((id) =>
      result({ guid: `https://vimm.net/vault/${id}` })
    );
    expect(rows.filter(dedupeIdenticalResults())).toHaveLength(1);
  });

  it("keeps genuinely different titles from the same indexer", () => {
    // Also real, from the same search -- these must survive.
    const rows = [
      result({}),
      result({ title: "Final Fantasy VII (Interactive Sampler CD) (PS1)" }),
      result({ title: "Final Fantasy VII (Square Soft on PlayStation Previews) (PS1)" }),
    ];
    expect(rows.filter(dedupeIdenticalResults())).toHaveLength(3);
  });

  it("keeps same-titled releases that differ in size or seeders", () => {
    const rows = [
      result({ sourceType: "torrent", sizeBytes: 100, seeders: 5 }),
      result({ sourceType: "torrent", sizeBytes: 200, seeders: 5 }),
      result({ sourceType: "torrent", sizeBytes: 200, seeders: 9 }),
    ];
    expect(rows.filter(dedupeIdenticalResults())).toHaveLength(3);
  });

  it("does not share state between searches", () => {
    const rows = [result({})];
    expect(rows.filter(dedupeIdenticalResults())).toHaveLength(1);
    expect(rows.filter(dedupeIdenticalResults())).toHaveLength(1);
  });
});
