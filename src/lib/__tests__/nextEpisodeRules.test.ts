import { describe, expect, it } from "vitest";
import { nextEpisode } from "../nextEpisodeRules";

const eps = [{ episodeNumber: 1, name: "A" }, { episodeNumber: 2, name: "B" }];

describe("nextEpisode", () => {
  it("goes to the next episode in the season", () => {
    expect(nextEpisode("7", 18, 1, eps, { numberOfSeasons: 18 })).toMatchObject({ href: "/show/7/episode/18/2", label: "S18 E2 · B" });
  });
  it("crosses into the next season, with or without its episode list", () => {
    expect(nextEpisode("7", 3, 2, eps, { numberOfSeasons: 5, nextSeasonEpisodes: [{ episodeNumber: 1, name: "C" }] })?.label).toBe("S4 E1 · C");
    expect(nextEpisode("7", 3, 2, eps, { numberOfSeasons: 5 })?.href).toBe("/show/7/episode/4/1");
  });
  it("stops at the final episode and after specials", () => {
    expect(nextEpisode("7", 5, 2, eps, { numberOfSeasons: 5 })).toBeNull();
    expect(nextEpisode("7", 0, 2, eps, { numberOfSeasons: 5 })).toBeNull();
  });
});
