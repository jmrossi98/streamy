import { describe, it, expect } from "vitest";
import {
  buildRows, parseTags, slugFromFileName, titleFromFileName,
  type FlashGameSummary,
} from "../flashGameRules";

const game = (title: string, tags: string[] = []): FlashGameSummary => ({
  slug: title.toLowerCase().replace(/\W+/g, "-"),
  title, developer: "", description: "", tags,
  fileName: `${title}.swf`, width: 640, height: 480, isActionScript3: false,
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
  // Flashpoint tags are genuinely uneven -- a game can carry six or none --
  // so a game belongs in every row it qualifies for rather than being forced
  // into one.
  it("puts a multi-tagged game in each of its rows", () => {
    const g = game("Multi", ["Action", "Puzzle"]);
    const rows = buildRows([g, ...Array.from({ length: 3 }, (_, i) => game(`A${i}`, ["Action"])),
                            ...Array.from({ length: 3 }, (_, i) => game(`P${i}`, ["Puzzle"]))]);
    const action = rows.find((r) => r.title === "Action")!;
    const puzzle = rows.find((r) => r.title === "Puzzle")!;
    expect(action.games).toContain(g);
    expect(puzzle.games).toContain(g);
  });

  // A row of one is noise, not navigation.
  it("folds tags with too few games into the catch-all", () => {
    const rows = buildRows([game("Lonely", ["Roguelike"]), game("Also", ["Metroidvania"])]);
    expect(rows.map((r) => r.title)).toEqual(["All Games"]);
    expect(rows[0].games).toHaveLength(2);
  });

  it("always ends with a catch-all so nothing is unreachable", () => {
    const rows = buildRows(Array.from({ length: 5 }, (_, i) => game(`G${i}`, ["Action"])));
    expect(rows.at(-1)!.key).toBe("all");
    expect(rows.at(-1)!.games).toHaveLength(5);
  });

  // A library with no tags at all -- every hand-dropped SWF starts this way --
  // still has to render something.
  it("renders an untagged library", () => {
    const rows = buildRows([game("A"), game("B")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("All Games");
  });

  it("returns nothing for an empty library rather than a bare heading", () => {
    expect(buildRows([])).toEqual([]);
  });

  // Bookkeeping tags, not genres -- "Auto-zipped" appears on a huge share of
  // Flashpoint entries and means nothing to a person browsing.
  it("ignores bookkeeping tags", () => {
    const rows = buildRows(Array.from({ length: 4 }, (_, i) => game(`G${i}`, ["Auto-zipped"])));
    expect(rows.map((r) => r.title)).toEqual(["All Games"]);
  });

  it("orders rows by size, then alphabetically", () => {
    const rows = buildRows([
      ...Array.from({ length: 5 }, (_, i) => game(`A${i}`, ["Action"])),
      ...Array.from({ length: 3 }, (_, i) => game(`Z${i}`, ["Zany"])),
      ...Array.from({ length: 3 }, (_, i) => game(`B${i}`, ["Board"])),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Action", "Board", "Zany", "All Games"]);
  });
});
