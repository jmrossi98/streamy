import { describe, it, expect } from "vitest";
import { isPlayableHere, pickGameSwf, toFlashpointGame } from "../flashpoint";

// Shaped from a real response (verified live 2026-09-13 against
// db-api.unstable.life), not from the docs -- the docs are a TODO in their repo.
const REAL = {
  id: "000e582d-5638-4220-8c6e-cab655ec51ed",
  library: "arcade",
  title: "Mario Destroyer",
  alternateTitles: "",
  series: "",
  developer: "",
  publisher: "Play Toon Games",
  source: "playmariogames.com",
  tags: ["Action", "Super Mario", "Vertically-Scrolling Shooter", "Top-Down", "Auto-zipped"],
  platform: "Flash",
  playMode: "Single Player",
  status: "Playable",
  version: "",
  releaseDate: "",
  language: "en",
  notes: "",
  originalDescription: "Mario now pilots a spacecraft to finally put an end to the hated enemies.",
  zipped: true,
};

describe("toFlashpointGame", () => {
  it("maps a real search hit", () => {
    const g = toFlashpointGame(REAL)!;
    expect(g.id).toBe(REAL.id);
    expect(g.title).toBe("Mario Destroyer");
    expect(g.publisher).toBe("Play Toon Games");
    expect(g.platform).toBe("Flash");
    expect(g.status).toBe("Playable");
    expect(g.description).toContain("spacecraft");
    expect(g.tags).toContain("Super Mario");
  });

  // Most entries are missing most optional fields -- empty developer and
  // releaseDate are the norm, not the exception. Dropping those rows would
  // throw away most of the archive.
  it("keeps an entry that is missing every optional field", () => {
    const g = toFlashpointGame({ id: "x", title: "Bare Entry" })!;
    expect(g).toMatchObject({
      title: "Bare Entry", developer: "", publisher: "",
      releaseDate: "", language: "", description: "", tags: [],
    });
  });

  it("drops an entry with no id or no title", () => {
    expect(toFlashpointGame({ title: "No id" })).toBeNull();
    expect(toFlashpointGame({ id: "no-title" })).toBeNull();
    expect(toFlashpointGame({})).toBeNull();
  });

  it("survives tags arriving as something other than an array of strings", () => {
    expect(toFlashpointGame({ id: "a", title: "T", tags: "Action" })!.tags).toEqual([]);
    expect(toFlashpointGame({ id: "a", title: "T", tags: null })!.tags).toEqual([]);
    expect(toFlashpointGame({ id: "a", title: "T", tags: ["ok", 7, null] })!.tags).toEqual(["ok"]);
  });

  it("reads the description from originalDescription", () => {
    expect(toFlashpointGame({ id: "a", title: "T", originalDescription: "Hello" })!.description)
      .toBe("Hello");
  });
});

describe("isPlayableHere", () => {
  // The archive covers Shockwave, Unity, HTML5 and more. Ruffle plays exactly
  // one of them, so everything else has to be filtered out before it reaches a
  // row that implies you can click it.
  it("accepts Flash and rejects every other platform", () => {
    const g = (platform: string) => toFlashpointGame({ id: "a", title: "T", platform })!;
    expect(isPlayableHere(g("Flash"))).toBe(true);
    for (const p of ["Shockwave", "Unity", "HTML5", "Java", "3D Groove GX", ""]) {
      expect(isPlayableHere(g(p))).toBe(false);
    }
  });

  it("is case-insensitive about the platform name", () => {
    const g = toFlashpointGame({ id: "a", title: "T", platform: "flash" })!;
    expect(isPlayableHere(g)).toBe(true);
  });
});

describe("pickGameSwf", () => {
  const e = (path: string, size: number) => ({ path, size });

  // A GameZIP mirrors the original site's directory tree, so it routinely
  // carries loader shims, ad stubs and unrelated SWFs beside the game. Taking
  // the first one gets you a blank frame or an advert.
  it("prefers a SWF under content/ over packaging alongside it", () => {
    expect(pickGameSwf([
      e("readme.swf", 900),
      e("content/example.com/game.swf", 5_000_000),
    ])).toBe("content/example.com/game.swf");
  });

  it("skips loaders, preloaders and ad stubs by name", () => {
    expect(pickGameSwf([
      e("content/site/preloader.swf", 4_000),
      e("content/site/ads.swf", 2_000),
      e("content/site/main.swf", 3_000_000),
    ])).toBe("content/site/main.swf");
  });

  // A loader is tiny next to what it loads, so size is the tiebreak.
  it("takes the largest remaining candidate", () => {
    expect(pickGameSwf([
      e("content/a.swf", 1_000),
      e("content/b.swf", 9_000_000),
      e("content/c.swf", 50_000),
    ])).toBe("content/b.swf");
  });

  // Better the biggest of what exists than giving up on a game that is there.
  it("falls back rather than giving up when everything looks like packaging", () => {
    expect(pickGameSwf([e("content/loader.swf", 10), e("content/ads.swf", 900)]))
      .toBe("content/ads.swf");
  });

  it("returns null when the archive has no SWF at all", () => {
    expect(pickGameSwf([e("content/index.html", 500), e("content/game.dcr", 9_000)])).toBeNull();
    expect(pickGameSwf([])).toBeNull();
  });

  it("handles an archive with exactly one SWF", () => {
    expect(pickGameSwf([e("content/only.swf", 1)])).toBe("content/only.swf");
  });
});

