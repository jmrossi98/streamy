import { describe, it, expect } from "vitest";
import { titleSimilarity } from "../romNames";

// Same threshold value as mediabox-infra's deck/steam_sync.py (SGDB_MIN_SIMILARITY
// = 0.72), chosen against these exact real observed cases -- not because the two
// implementations need to agree pick-for-pick, but because this threshold is
// proven against this app's own real bad matches, not re-derived from scratch.
const MIN_SIMILARITY = 0.72;

describe("titleSimilarity", () => {
  it("scores an identical title at 1", () => {
    expect(titleSimilarity("Vagrant Story", "Vagrant Story")).toBe(1);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(titleSimilarity("Spyro the Dragon (USA)", "SPYRO THE DRAGON")).toBeGreaterThanOrEqual(
      MIN_SIMILARITY
    );
  });

  it("clears the threshold for a real near-match (reordering/formatting noise)", () => {
    // Real case this app hit: the Legend of Zelda title reads differently
    // between ROM naming and SGDB's own listing.
    expect(
      titleSimilarity("Legend of Zelda, The - The Wind Waker", "The Legend of Zelda: The Wind Waker")
    ).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  it("rejects the real false-positive this threshold exists for", () => {
    // Confirmed live: gamarr/SGDB's own top-ranked result for "DreamWorks
    // Madagascar" was an unrelated VR title -- a wrong pick that would have
    // stuck as this game's cover art forever if nothing gated it.
    expect(titleSimilarity("DreamWorks Madagascar", "DreamWorks Voltron VR Chronicles")).toBeLessThan(
      MIN_SIMILARITY
    );
  });

  it("rejects two different numbered sequels sharing everything but the number", () => {
    // Confirmed live (2026-09-04): Super Mario Bros., Bros. 2, and Bros. 3
    // were showing as if they were the same game in the Games UI --
    // titleSimilarity alone scored these ~0.94 with no signal weighing the
    // one token that actually distinguishes them.
    expect(titleSimilarity("Super Mario Bros", "Super Mario Bros 2")).toBeLessThan(MIN_SIMILARITY);
    expect(titleSimilarity("Mega Man 2", "Mega Man 3")).toBeLessThan(MIN_SIMILARITY);
    expect(titleSimilarity("Dragon Warrior II", "Dragon Warrior III")).toBeLessThan(MIN_SIMILARITY);
  });

  it("still matches the same numbered sequel across formatting noise", () => {
    expect(
      titleSimilarity("Mega Man 2 (USA)", "Mega Man 2")
    ).toBeGreaterThanOrEqual(MIN_SIMILARITY);
  });

  it("rejects a compilation merely containing the real title as a substring", () => {
    // Confirmed live: all three SpongeBob titles matched a 4-game compilation
    // listing before a similarity gate existed.
    expect(
      titleSimilarity(
        "SpongeBob SquarePants: Battle for Bikini Bottom",
        "Nickelodeon SpongeBob SquarePants Collection (4 Games)"
      )
    ).toBeLessThan(MIN_SIMILARITY);
  });
});
