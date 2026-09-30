import { describe, expect, it } from "vitest";
import { earliestDownloaded } from "../playStartRules";

const ep = (seasonNumber: number, episodeNumber: number, hasFile: boolean) => ({ seasonNumber, episodeNumber, hasFile });

describe("earliestDownloaded", () => {
  it("picks the first episode on disk, not S1E1", () => {
    expect(earliestDownloaded([ep(1, 1, false), ep(18, 2, true), ep(18, 1, true), ep(17, 9, false)])).toEqual({
      seasonNumber: 18,
      episodeNumber: 1,
    });
  });
  it("skips specials and returns null when nothing is downloaded", () => {
    expect(earliestDownloaded([ep(0, 1, true), ep(2, 3, true)])).toEqual({ seasonNumber: 2, episodeNumber: 3 });
    expect(earliestDownloaded([ep(1, 1, false)])).toBeNull();
  });
});
