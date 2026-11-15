import { describe, expect, it } from "vitest";
import { gameJobName, parseGameJobName, systemStatus, type GameJob, type LibraryGame } from "../gameJobRules";

const SWITCH = { slug: "switch", folders: ["switch"], gamarrSlug: "switch" };
const GC = { slug: "gamecube", folders: ["gamecube", "gc"], gamarrSlug: "gamecube" };
const job = (name: string, state: GameJob["state"], progress: number | null = null): GameJob => ({ name, state, progress, failMessage: null });
const lib = (over: Partial<LibraryGame>): LibraryGame => ({
  gameKey: "k",
  displayTitle: "Super Mario Odyssey",
  system: "switch",
  platformSlug: "switch",
  status: "library",
  progress: null,
  ...over,
});

describe("game job names", () => {
  it("carry the console and the IGDB id, and read back", () => {
    const name = gameJobName("switch", 26758, "Super.Mario.Odyssey.NSW-BigBlueBox");
    expect(name).toBe("[game switch igdb:26758] Super.Mario.Odyssey.NSW-BigBlueBox");
    expect(parseGameJobName(name)).toEqual({ system: "switch", igdbId: 26758, release: "Super.Mario.Odyssey.NSW-BigBlueBox" });
    expect(parseGameJobName("Some.Show.S01E01-GROUP")).toBeNull();
  });
});

describe("systemStatus", () => {
  const ID = 26758;
  const mine = (state: GameJob["state"], progress: number | null = null) => job(gameJobName("switch", ID, "Super.Mario.Odyssey.NSW-BigBlueBox"), state, progress);

  it("is owned when the library has it in the console's folder", () => {
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [], [lib({ gameKey: "switch::smo" })])).toEqual({ state: "owned", gameKey: "switch::smo" });
    expect(systemStatus(ID, "Metroid Prime", GC, [], [lib({ displayTitle: "Metroid Prime (USA)", system: "gc" })]).state).toBe("owned");
    // Another console's copy, or another game, is not this one.
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [], [lib({ system: "wiiu" })]).state).toBe("available");
    expect(systemStatus(ID, "Super Mario Odyssey 2", SWITCH, [], [lib({})]).state).toBe("available");
  });

  it("follows its own SABnzbd job, then gamarr's queue", () => {
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [mine("downloading", 40)], [])).toEqual({ state: "downloading", progress: 40, via: "usenet" });
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [mine("completed")], []).state).toBe("importing");
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [job(gameJobName("switch", 1, "Other"), "downloading", 5)], []).state).toBe("available");
    expect(
      systemStatus(ID, "Super Mario Odyssey", SWITCH, [], [lib({ status: "downloading", progress: 12, system: null })])
    ).toEqual({ state: "downloading", progress: 12, via: "gamarr" });
  });

  it("says a failed download failed, and a fresh try supersedes it", () => {
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [{ ...mine("failed"), failMessage: "Out of retention" }], [])).toEqual({
      state: "failed",
      message: "Out of retention",
    });
    expect(systemStatus(ID, "Super Mario Odyssey", SWITCH, [mine("failed"), mine("downloading", 3)], []).state).toBe("downloading");
  });
});
