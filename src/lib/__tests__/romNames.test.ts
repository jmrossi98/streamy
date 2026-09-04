import { describe, it, expect } from "vitest";
import { romStemOf, romSearchTitle } from "../romNames";
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
