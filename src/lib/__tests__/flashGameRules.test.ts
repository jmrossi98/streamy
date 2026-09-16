import { describe, it, expect } from "vitest";
import {
  buildRows, parseTags, slugFromFileName, titleFromFileName,
  type FlashGameSummary,
} from "../flashGameRules";

const game = (title: string, tags: string[] = []): FlashGameSummary => ({
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  title, flashpointId: null, developer: "", description: "", tags,
  fileName: `${title}.swf`, playable: true, width: 640, height: 480, isActionScript3: false,
});

describe("slugFromFileName", () => {
  it("derives a URL-safe slug", () => {
    expect(slugFromFileName("thegamegame.swf")).toBe("thegamegame");
    expect(slugFromFileName("The Game Game.swf")).toBe("the-game-game");
    expect(slugFromFileName("Bloons Tower Defense 5 (v1.2).swf")).toBe("bloons-tower-defense-5-v1-2");
  });

  it("collapses punctuation without leaving stray separators", () => {
    expect(slugFromFileName("Bob's -- Adventure!.swf")).toBe("bob-s-adventure");
    expect(slugFromFileName("---weird---.swf")).toBe("weird");
  });

  // Derived from the filename, not the title, so editing a title later can't
  // change a game's URL.
  it("is case-insensitive about the extension", () => {
    expect(slugFromFileName("GAME.SWF")).toBe("game");
  });

  it("never returns an empty slug", () => {
    expect(slugFromFileName("!!!.swf")).toBe("game");
    expect(slugFromFileName(".swf")).toBe("game");
  });
});

describe("titleFromFileName", () => {
  // A guess, and the point is that it's an editable one rather than showing
  // someone "thegamegame.swf".
  it("makes a filename readable", () => {
    expect(titleFromFileName("super-mario-63.swf")).toBe("Super Mario 63");
    expect(titleFromFileName("alien_hominid.swf")).toBe("Alien Hominid");
  });

  it("leaves very short words alone", () => {
    expect(titleFromFileName("go-go-racer.swf")).toBe("go go Racer");
  });

  it("falls back to the filename when there's nothing left", () => {
    expect(titleFromFileName(".swf")).toBe(".swf");
  });
});

describe("parseTags", () => {
  it("splits and trims, dropping empties", () => {
    expect(parseTags("Action, Puzzle ,, Platformer ")).toEqual(["Action", "Puzzle", "Platformer"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("buildRows", () => {
  // Genre shelves come from the generated catalogue now, not from tags across
  // whatever happens to be downloaded. That produced a wall of near-duplicate
  // rows ("Action", "Arcade", "Platformer") built from a handful of games,
  // sitting above the real genre shelves.
  it("emits no genre rows, whatever the tags", () => {
    const games = [
      ...Array.from({ length: 5 }, (_, i) => game(`A${i}`, ["Action"])),
      ...Array.from({ length: 4 }, (_, i) => game(`P${i}`, ["Puzzle", "Platformer"])),
    ];
    expect(buildRows(games)).toEqual([]);
  });

  it("returns nothing for an empty library rather than a bare heading", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("buildRows — My List", () => {
  const mine = game("Saved", ["Action"]);
  const others = Array.from({ length: 4 }, (_, i) => game(`G${i}`, ["Action"]));

  it("returns My List as the only row", () => {
    const rows = buildRows([...others, mine], new Set([mine.slug]));
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("my-list");
    expect(rows[0].title).toBe("My List");
    expect(rows[0].games).toEqual([mine]);
  });

  it("omits the row entirely when nothing is listed", () => {
    expect(buildRows([...others, mine], new Set())).toEqual([]);
    expect(buildRows([...others, mine])).toEqual([]);
  });

  // A list entry whose game is gone -- the relation cascades, but a stale set
  // passed in must not produce a row of nothing.
  it("omits the row when the listed slugs match no game", () => {
    expect(buildRows(others, new Set(["deleted-game"]))).toEqual([]);
  });

  it("shows a single listed game even in an otherwise untagged library", () => {
    const a = game("A");
    expect(buildRows([a, game("B")], new Set([a.slug])).map((r) => r.key)).toEqual(["my-list"]);
  });
});
