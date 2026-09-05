import { describe, expect, it } from "vitest";
import {
  cleanLibrary,
  groupMultiDiscGames,
  isJunkLibraryItem,
  repairGenericTitle,
} from "../gameLibraryCleanup";
import type { LibraryGame } from "../gamarr";

function item(over: Partial<LibraryGame>): LibraryGame {
  return {
    id: 1,
    fileName: "Some Game (USA)",
    romStem: "Some Game (USA)",
    filePath: "/data/roms/psx/Some Game (USA).chd",
    system: "psx",
    platform: "PSX",
    sizeBytes: 1000,
    ...over,
  };
}

describe("isJunkLibraryItem", () => {
  it("flags a BIOS file", () => {
    expect(
      isJunkLibraryItem(
        item({ fileName: "ps2_bios", filePath: "/data/roms/ps2/ps2_bios.zip", system: "ps2" })
      )
    ).toBe(true);
  });

  it("leaves a real game alone", () => {
    expect(isJunkLibraryItem(item({}))).toBe(false);
  });
});

describe("repairGenericTitle", () => {
  it("recovers the real game name from a PS3 USRDIR row", () => {
    const i = item({
      fileName: "USRDIR",
      filePath: "/data/roms/ps3/Demon's Souls (USA)/PS3_GAME/USRDIR",
      system: "ps3",
      platform: "PS3",
    });
    expect(repairGenericTitle(i)).toBe("Demon's Souls (USA)");
  });

  it("leaves a normal title alone", () => {
    expect(repairGenericTitle(item({}))).toBe("Some Game (USA)");
  });
});

describe("cleanLibrary", () => {
  it("drops a BIOS entry entirely", () => {
    const out = cleanLibrary([
      item({ id: 1 }),
      item({ id: 2, fileName: "ps2_bios", filePath: "/data/roms/ps2/ps2_bios.zip", system: "ps2" }),
    ]);
    expect(out.map((g) => g.id)).toEqual([1]);
  });

  it("repairs a PS3 USRDIR title and its romStem", () => {
    const out = cleanLibrary([
      item({
        id: 1,
        fileName: "USRDIR",
        romStem: "USRDIR",
        filePath: "/data/roms/ps3/Demon's Souls (USA)/PS3_GAME/USRDIR",
        system: "ps3",
      }),
    ]);
    expect(out[0].fileName).toBe("Demon's Souls (USA)");
    expect(out[0].romStem).toBe("Demon's Souls (USA)");
  });

  it("keeps the compressed sibling and drops the raw one", () => {
    const out = cleanLibrary([
      item({
        id: 1,
        fileName: "Wind Waker",
        filePath: "/data/roms/gamecube/Wind Waker (USA).iso",
        system: "gamecube",
      }),
      item({
        id: 2,
        fileName: "Wind Waker",
        filePath: "/data/roms/gamecube/Wind Waker (USA).rvz",
        system: "gamecube",
      }),
    ]);
    expect(out.map((g) => g.id)).toEqual([2]);
  });

  it("handles the compound .nkit.iso / .nkit.rvz case", () => {
    const out = cleanLibrary([
      item({
        id: 1,
        fileName: "Super Mario Galaxy.nkit",
        filePath: "/data/roms/wii/Super Mario Galaxy (USA).nkit.iso",
        system: "wii",
      }),
      item({
        id: 2,
        fileName: "Super Mario Galaxy.nkit.rvz",
        filePath: "/data/roms/wii/Super Mario Galaxy (USA).nkit.rvz",
        system: "wii",
      }),
    ]);
    expect(out.map((g) => g.id)).toEqual([2]);
  });

  it("leaves two genuinely different games on the same platform alone", () => {
    const out = cleanLibrary([
      item({ id: 1, fileName: "Game A", filePath: "/data/roms/psx/Game A.chd", system: "psx" }),
      item({ id: 2, fileName: "Game B", filePath: "/data/roms/psx/Game B.chd", system: "psx" }),
    ]);
    expect(out.map((g) => g.id).sort()).toEqual([1, 2]);
  });

  it("drops a standalone emulator executable", () => {
    // Confirmed live: Cemu.exe was sitting in /data/roms/wiiu/ and gamarr's
    // scanner listed it as if it were a Wii U game.
    const out = cleanLibrary([
      item({ id: 1, fileName: "Cemu", filePath: "/data/roms/wiiu/Cemu.exe", system: "wiiu" }),
      item({ id: 2, fileName: "A Real Game", filePath: "/data/roms/wiiu/A Real Game.rvz", system: "wiiu" }),
    ]);
    expect(out.map((g) => g.id)).toEqual([2]);
  });
});

describe("groupMultiDiscGames", () => {
  function disc(n: number, id: number, title = "Final Fantasy VIII (USA)") {
    const fileName = `${title} (Disc ${n})`;
    return item({
      id,
      fileName,
      romStem: fileName,
      filePath: `/data/roms/psx/${fileName}.chd`,
      system: "psx",
      sizeBytes: 100,
    });
  }

  it("groups four discs into one entry keyed by disc 1", () => {
    const out = groupMultiDiscGames([disc(3, 3), disc(1, 1), disc(4, 4), disc(2, 2)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
    expect(out[0].discs?.map((d) => d.label)).toEqual(["Disc 1", "Disc 2", "Disc 3", "Disc 4"]);
  });

  it("sums size across every disc", () => {
    const out = groupMultiDiscGames([disc(1, 1), disc(2, 2)]);
    expect(out[0].sizeBytes).toBe(200);
  });

  it("keeps two different multi-disc games separate", () => {
    const out = groupMultiDiscGames([
      disc(1, 1),
      disc(2, 2),
      disc(1, 3, "Parasite Eve (USA)"),
      disc(2, 4, "Parasite Eve (USA)"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.discs?.length)).toEqual([2, 2]);
  });

  it("leaves a lone disc-labeled file ungrouped", () => {
    // Star Ocean is real in this library: only "(Disc 1)" is present, so
    // there's no group to form -- inventing one would be wrong.
    const out = groupMultiDiscGames([disc(1, 1, "Star Ocean (USA)")]);
    expect(out).toHaveLength(1);
    expect(out[0].discs).toBeUndefined();
  });

  it("leaves a single-disc game untouched", () => {
    const out = groupMultiDiscGames([
      item({ id: 9, fileName: "Vagrant Story (USA)", filePath: "/data/roms/psx/Vagrant Story (USA).chd" }),
    ]);
    expect(out[0].discs).toBeUndefined();
  });
});
