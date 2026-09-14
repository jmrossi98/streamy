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

  // A row of one is noise, not navigation -- and with no catch-all, a game
  // whose only tags are rare simply doesn't get a shelf. It stays reachable
  // from My List and search.
  it("gives no row to tags with too few games", () => {
    expect(buildRows([game("Lonely", ["Roguelike"]), game("Also", ["Metroidvania"])])).toEqual([]);
  });

  // The catch-all was removed deliberately: it repeated everything above it,
  // doubling the page for no new information.
  it("emits no catch-all row", () => {
    const rows = buildRows(Array.from({ length: 5 }, (_, i) => game(`G${i}`, ["Action"])));
    expect(rows.map((r) => r.key)).toEqual(["tag:Action"]);
  });

  // An untagged library produces no rows at all now. That is fine: the
  // archive browse section below covers discovery, and My List covers what
  // someone actually cares about.
  it("produces no rows for an untagged library", () => {
    expect(buildRows([game("A"), game("B")])).toEqual([]);
  });

  it("returns nothing for an empty library rather than a bare heading", () => {
    expect(buildRows([])).toEqual([]);
  });

  // Bookkeeping tags, not genres -- "Auto-zipped" appears on a huge share of
  // Flashpoint entries and means nothing to a person browsing.
  it("ignores bookkeeping tags", () => {
    const rows = buildRows(Array.from({ length: 4 }, (_, i) => game(`G${i}`, ["Auto-zipped"])));
    expect(rows).toEqual([]);
  });

  it("orders rows by size, then alphabetically", () => {
    const rows = buildRows([
      ...Array.from({ length: 5 }, (_, i) => game(`A${i}`, ["Action"])),
      ...Array.from({ length: 3 }, (_, i) => game(`Z${i}`, ["Zany"])),
      ...Array.from({ length: 3 }, (_, i) => game(`B${i}`, ["Board"])),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Action", "Board", "Zany"]);
  });
});

describe("buildRows — My List", () => {
  const mine = game("Saved", ["Action"]);
  const others = Array.from({ length: 4 }, (_, i) => game(`G${i}`, ["Action"]));

  // The row someone came for. Burying it under whichever genre happens to be
  // biggest makes it useless.
  it("pins My List as the very first row", () => {
    const rows = buildRows([...others, mine], new Set([mine.slug]));
    expect(rows[0].key).toBe("my-list");
    expect(rows[0].title).toBe("My List");
    expect(rows[0].games).toEqual([mine]);
  });

  it("keeps a listed game in its genre rows too", () => {
    const rows = buildRows([...others, mine], new Set([mine.slug]));
    expect(rows.find((r) => r.title === "Action")!.games).toContain(mine);
    expect(rows.at(-1)!.games).toContain(mine);
  });

  it("omits the row entirely when nothing is listed", () => {
    expect(buildRows([...others, mine], new Set()).some((r) => r.key === "my-list")).toBe(false);
    expect(buildRows([...others, mine]).some((r) => r.key === "my-list")).toBe(false);
  });

  // A list entry whose game is gone -- the relation cascades, but a stale set
  // passed in must not produce a row of nothing.
  it("omits the row when the listed slugs match no game", () => {
    expect(buildRows(others, new Set(["deleted-game"])).some((r) => r.key === "my-list")).toBe(false);
  });

  it("shows a single listed game even in an otherwise untagged library", () => {
    const a = game("A");
    const rows = buildRows([a, game("B")], new Set([a.slug]));
    expect(rows.map((r) => r.key)).toEqual(["my-list"]);
  });
});

