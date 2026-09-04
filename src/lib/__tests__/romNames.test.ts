import { describe, it, expect } from "vitest";
import { romStemOf, romSearchTitle, gameKeyOf } from "../romNames";
import { decodeEntities } from "../gamarr";

// romStemOf is the key an artwork override is stored under, and the whole
// point of dropping the extension is that mediabox's hourly rom-compress.sh
// rewrites .bin/.iso/.cue to .chd in place. If this ever went back to keying
// on the full filename, every hand-picked cover would silently stop applying
// an hour after the game was downloaded -- with nothing to indicate why.
describe("romStemOf", () => {
  it("keeps a pick stable across the .bin -> .chd compression that runs hourly", () => {
    expect(romStemOf("Spyro the Dragon (USA).bin")).toBe(
      romStemOf("Spyro the Dragon (USA).chd")
    );
  });

  it("survives the .iso -> .chd case too (PS2's usual format)", () => {
    expect(romStemOf("DreamWorks Madagascar (USA) (v3.01).iso")).toBe(
      "DreamWorks Madagascar (USA) (v3.01)"
    );
  });

  it("only strips the final extension, not dotted version numbers in the name", () => {
    // A leading-dot filename has no stem to strip, and a version like
    // "(v3.01)" must not be mistaken for an extension boundary.
    expect(romStemOf("Game (v1.2).chd")).toBe("Game (v1.2)");
    expect(romStemOf("no-extension")).toBe("no-extension");
  });
});

// The picker seeds its SteamGridDB search from this. Both cases below are
// real names from the library that the Deck's own auto-matcher previously got
// wrong (Madagascar matched an unrelated VR game), which is the reason a
// manual picker exists at all.
describe("romSearchTitle", () => {
  it("strips region and version tags", () => {
    expect(romSearchTitle("DreamWorks Madagascar (USA) (v3.01)")).toBe("DreamWorks Madagascar");
  });

  it("strips bracketed release tags", () => {
    expect(romSearchTitle("PS2 - Ratchet and Clank [1 DVD5 - Multi5 PAL]")).toBe(
      "PS2 - Ratchet and Clank"
    );
  });

  it("leaves an already-clean title alone", () => {
    expect(romSearchTitle("Vagrant Story")).toBe("Vagrant Story");
  });
});

// Confirmed live against gamarr: Vimm's results come back with raw HTML
// entities ("Crash Bash &amp; Spyro: Year of the Dragon"), because that
// source is scraped from a web page. Rendering those verbatim shows the
// entity to the viewer.
describe("decodeEntities", () => {
  it("decodes the ampersand that real gamarr results actually contain", () => {
    expect(decodeEntities("Crash Bash &amp; Spyro: Year of the Dragon (PS1)")).toBe(
      "Crash Bash & Spyro: Year of the Dragon (PS1)"
    );
  });

  it("decodes both apostrophe encodings seen in release names", () => {
    expect(decodeEntities("Conker&#39;s Bad Fur Day")).toBe("Conker's Bad Fur Day");
    expect(decodeEntities("Conker&apos;s Bad Fur Day")).toBe("Conker's Bad Fur Day");
  });

  it("leaves text with no entities untouched", () => {
    expect(decodeEntities("Spyro the Dragon (USA)")).toBe("Spyro the Dragon (USA)");
  });
});

// gameKeyOf is what getGamesList() merges gamarr's wishlist, active-downloads,
// and library-scan surfaces on -- none of which share any other common id.
// Getting this wrong either splits one game into two rows (wishlist entry
// never disappears once the download completes) or, worse, silently
// collapses two different games into one.
describe("gameKeyOf", () => {
  it("matches the same game across gamarr's title-formatting differences", () => {
    // The exact real-world case this exists for: Vimm's Lair result vs.
    // gamarr's own downloads-list title for the same release.
    expect(gameKeyOf("ps1", "Crash Bash & Spyro: Year of the Dragon (PS1)")).toBe(
      gameKeyOf("ps1", "Crash Bash and Spyro Year of the Dragon PS1")
    );
  });

  it("is case-insensitive and punctuation-insensitive", () => {
    expect(gameKeyOf("psx", "Spyro the Dragon (USA)")).toBe(
      gameKeyOf("psx", "SPYRO THE DRAGON (usa)!!!")
    );
  });

  it("does not collapse different games with similar titles", () => {
    expect(gameKeyOf("ps2", "DreamWorks Madagascar")).not.toBe(
      gameKeyOf("ps2", "DreamWorks Madagascar 2")
    );
  });

  it("treats the same title on different platforms as different games", () => {
    expect(gameKeyOf("psx", "Spyro the Dragon")).not.toBe(gameKeyOf("ps2", "Spyro the Dragon"));
  });

  it("produces a URL-safe route segment (no slashes)", () => {
    expect(gameKeyOf("ps2", "Ratchet & Clank / Multi5")).not.toMatch(/\//);
  });
});
