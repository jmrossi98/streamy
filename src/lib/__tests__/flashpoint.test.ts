import { describe, it, expect } from "vitest";
import { isPlayableHere, toFlashpointGame } from "../flashpoint";

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
