import { describe, expect, it } from "vitest";
import {
  describePack,
  packProblemText,
  formatEta,
  isVideoFile,
  packCoversSeason,
  packFileEpisode,
  packTag,
  packTarget,
  PACK_IMPORT_GRACE_MS,
} from "../manualPackRules";

describe("packTarget", () => {
  it("reads the show and season from a torrent's tags", () => {
    expect(packTarget("streamy-series-64-s1")).toEqual({ seriesId: 64, seasonNumber: 1 });
    expect(packTarget("keep, streamy-series-7-s12")).toEqual({ seriesId: 7, seasonNumber: 12 });
    expect(packTag(64, 1)).toBe("streamy-series-64-s1");
  });
  it("is null for an untagged torrent or a look-alike tag", () => {
    expect(packTarget("")).toBeNull();
    expect(packTarget(null)).toBeNull();
    expect(packTarget("streamy-series-x-s1, series-64-s1")).toBeNull();
  });
});

describe("packFileEpisode", () => {
  it("reads 1x001-style names from the Rebelde pack", () => {
    expect(packFileEpisode("Primera Temporada/Rebelde 1x001.DVBRip.XViD.MP3.By.DrHouse.avi", 1)).toBe(1);
    expect(packFileEpisode("Primera Temporada/Rebelde 1x142.AVI", 1)).toBe(142);
    expect(packFileEpisode("Rebelde 1x066 (DVBRip By Marcelo).avi", 1)).toBe(66);
  });
  it("reads SxxEyy names", () => {
    expect(packFileEpisode("Show.S01E215.720p.mkv", 1)).toBe(215);
  });
  it("never files another season's episode, or a resolution, as this one", () => {
    expect(packFileEpisode("Rebelde 2x004.avi", 1)).toBeNull();
    expect(packFileEpisode("Show.1920x1080.mkv", 1)).toBeNull();
    expect(packFileEpisode("Show 1x00.avi", 1)).toBeNull();
    expect(packFileEpisode("Extras/making of.avi", 1)).toBeNull();
  });
});

describe("isVideoFile", () => {
  it("keeps video, drops samples and everything else", () => {
    expect(isVideoFile("a/Rebelde 1x001.AVI")).toBe(true);
    expect(isVideoFile("a/sample.mkv")).toBe(false);
    expect(isVideoFile("a/info.nfo")).toBe(false);
  });
});

describe("formatEta", () => {
  it("rounds to what a person wants to know", () => {
    expect(formatEta(482_682)).toBe("about 6 days");
    expect(formatEta(3 * 3600 + 600)).toBe("3 h 10 min");
    expect(formatEta(30)).toBe("1 min");
  });
  it("says nothing when qBittorrent has no estimate", () => {
    expect(formatEta(8_640_000)).toBeNull();
    expect(formatEta(0)).toBeNull();
    expect(formatEta(null)).toBeNull();
  });
});

describe("describePack", () => {
  const base = {
    progress: 0.02,
    dlSpeed: 480_000,
    etaSeconds: 2 * 86_400,
    connectedSeeds: 1,
    swarmSeeds: 1,
    state: "downloading",
    filesDone: 3,
    files: 215,
    imported: 3,
  };
  it("says who it is coming from, how fast, and what has landed", () => {
    expect(describePack(base)).toBe("1 seeder · 480 KB/s · about 2 days left · 3 of 215 episodes in the library");
  });
  it("says so when no seeder is connected", () => {
    expect(describePack({ ...base, connectedSeeds: 0, dlSpeed: 0 })).toBe(
      "No seeder connected (1 in the swarm) · 3 of 215 episodes in the library"
    );
    expect(describePack({ ...base, connectedSeeds: 0, swarmSeeds: 0, dlSpeed: 0 })).toBe(
      "No seeders right now · 3 of 215 episodes in the library"
    );
  });
  it("reports the import once the transfer is done", () => {
    expect(describePack({ ...base, progress: 1, imported: 200 })).toBe("Finished · importing, 200 of 215 episodes in the library");
    expect(describePack({ ...base, progress: 1, imported: 215 })).toBe("Finished · 215 of 215 episodes in the library");
  });
});

describe("packCoversSeason", () => {
  const now = 1_800_000_000_000;
  it("covers its season while downloading and for a while after", () => {
    expect(packCoversSeason({ progress: 0.5, completedOn: null }, now)).toBe(true);
    expect(packCoversSeason({ progress: 1, completedOn: now / 1000 - 3600 }, now)).toBe(true);
  });
  it("hands the season back to the searches once its imports had their time", () => {
    expect(packCoversSeason({ progress: 1, completedOn: (now - PACK_IMPORT_GRACE_MS - 1000) / 1000 }, now)).toBe(false);
    expect(packCoversSeason({ progress: 1, completedOn: null }, now)).toBe(false);
  });
});

describe("pack problems", () => {
  it("names the files the importer gave up on, and why", () => {
    expect(packProblemText([])).toBeNull();
    expect(
      packProblemText([{ file: "/data/torrents/manual-import/Primera Temporada/Rebelde 1x196_31-04-07.avi", reason: "unreadable-name" }])
    ).toBe("1 file needs a hand: Rebelde 1x196_31-04-07.avi (Sonarr can't read its name)");
    const many = Array.from({ length: 5 }, (_, i) => ({ file: `x/${i}.avi`, reason: "not-attached" as const }));
    expect(packProblemText(many)).toMatch(/^5 files need a hand: 0\.avi .*, and 2 more$/);
  });

  it("says so on a finished pack instead of 'importing' forever", () => {
    const base = { progress: 1, dlSpeed: 0, etaSeconds: null, connectedSeeds: 0, swarmSeeds: 0, state: "stalledUP", filesDone: 215, files: 215, imported: 214 };
    expect(describePack(base)).toBe("Finished · importing, 214 of 215 episodes in the library");
    expect(describePack({ ...base, problems: [{ file: "a/Rebelde 1x196_31-04-07.avi", reason: "unreadable-name" }] })).toBe(
      "Finished · 214 of 215 episodes in the library · 1 file needs a hand: Rebelde 1x196_31-04-07.avi (Sonarr can't read its name)"
    );
  });
});
