import { describe, expect, it } from "vitest";
import { isForSystem, rankGameReleases, releaseGameName } from "../gameReleaseRules";
import { systemBySlug, systemsForIgdbPlatforms } from "../gameSystems";

const sys = (slug: string) => systemBySlug(slug)!;
const usenet = (title: string, over: Record<string, unknown> = {}) => ({ title, protocol: "usenet", size: 5e9, grabs: 10, ...over });
const torrent = (title: string, seeders = 10) => ({ title, protocol: "torrent", size: 5e9, seeders });

describe("releaseGameName", () => {
  it("strips tags, brackets, extensions and the group", () => {
    expect(releaseGameName("FINAL FANTASY I-VI Pixel Remaster Collection NSW-HR")).toBe("FINAL FANTASY I-VI Pixel Remaster Collection");
    expect(releaseGameName("Super.Mario.Odyssey.NSW-BigBlueBox PROPER")).toBe("Super Mario Odyssey");
    expect(releaseGameName("Metroid Prime Trilogy USA Wii-OneUp")).toBe("Metroid Prime Trilogy");
    expect(releaseGameName("[NGC] Metroid Prime[idnahx]")).toBe("Metroid Prime");
    expect(releaseGameName("Super Mario Odyssey (World) [0100000000010000].xci")).toBe("Super Mario Odyssey");
    expect(releaseGameName("Ico &amp; Shadow of The Colossus (2011) [Ps3]")).toBe("Ico & Shadow of The Colossus");
  });
});

describe("isForSystem", () => {
  it("needs this console's tag and no other's", () => {
    expect(isForSystem("Super.Mario.Odyssey.NSW-BigBlueBox", sys("switch"))).toBe(true);
    expect(isForSystem("Metroid Prime Trilogy USA Wii-OneUp", sys("wii"))).toBe(true);
    expect(isForSystem("Metroid Prime Trilogy USA Wii-OneUp", sys("gamecube"))).toBe(false);
    expect(isForSystem("Mario Kart 8 WiiU-VENOM", sys("wii"))).toBe(false);
    expect(isForSystem("Mario Kart 8 WiiU-VENOM", sys("wiiu"))).toBe(true);
    expect(isForSystem("Shadow of the Colossus PS2", sys("psx"))).toBe(false);
    expect(isForSystem("Final Fantasy VII PSX", sys("psx"))).toBe(true);
    expect(isForSystem("Pokemon Crystal (GBC)", sys("gbc"))).toBe(true);
    expect(isForSystem("Pokemon Crystal (GBC)", sys("gb"))).toBe(false);
    expect(isForSystem("Kingdom Hearts HD 1.5 and 2.5 ReMIX 4.2 GB", sys("gb"))).toBe(false);
    expect(isForSystem("Collection PS2 PS3", sys("ps2"))).toBe(false);
  });
});

describe("rankGameReleases", () => {
  it("keeps the game for this console and drops ports, updates and other games", () => {
    const ranked = rankGameReleases(
      [
        usenet("FINAL FANTASY IV Update v1.2.0 NSW-SUXXORS"),
        usenet("FINAL.FANTASY.I-VI.Bundle.Pixel.Remaster-[FitGirl.Repack]"),
        usenet("FINAL FANTASY VI NSW-HR"),
        usenet("FINAL FANTASY V NSW-HR"),
        usenet("FINAL FANTASY V PS2-GROUP"),
      ],
      "Final Fantasy V",
      sys("switch")
    );
    expect(ranked.map((r) => r.release.title)).toEqual(["FINAL FANTASY V NSW-HR"]);
  });

  it("puts usenet first, a wanted region ahead of a foreign-only one, and skips dead torrents", () => {
    const ranked = rankGameReleases(
      [
        torrent("Super Mario Odyssey [Switch NSP]", 77),
        torrent("Super Mario Odyssey NSW", 0),
        usenet("Super.Mario.Odyssey.JPN.NSW-GROUP"),
        usenet("Super.Mario.Odyssey.NSW-BigBlueBox"),
      ],
      "Super Mario Odyssey",
      sys("switch")
    );
    expect(ranked.map((r) => r.release.title)).toEqual([
      "Super.Mario.Odyssey.NSW-BigBlueBox",
      "Super.Mario.Odyssey.JPN.NSW-GROUP",
      "Super Mario Odyssey [Switch NSP]",
    ]);
  });

  it("does not take a compilation for one of its games", () => {
    expect(rankGameReleases([usenet("Metroid Prime Trilogy USA Wii-OneUp")], "Metroid Prime", sys("wii"))).toEqual([]);
  });
});

describe("systemsForIgdbPlatforms", () => {
  it("maps IGDB platforms to the consoles Streamy can fetch for", () => {
    expect(systemsForIgdbPlatforms([6, 130, 8, 48]).map((s) => s.slug)).toEqual(["switch", "ps2"]);
    expect(systemsForIgdbPlatforms([58]).map((s) => s.slug)).toEqual(["snes"]);
  });
});
