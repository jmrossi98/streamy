import { describe, expect, it } from "vitest";
import { cleanLibrary, isJunkLibraryItem, repairGenericTitle } from "../gameLibraryCleanup";
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
});
