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
