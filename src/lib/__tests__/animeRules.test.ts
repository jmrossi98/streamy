import { describe, expect, it } from "vitest";
import { isAnime } from "@/lib/animeRules";

describe("isAnime", () => {
  it("needs both Animation and Japanese", () => {
    expect(isAnime(["Animation", "Action & Adventure"], "ja")).toBe(true);
    expect(isAnime(["Animation", "Comedy"], "en")).toBe(false);
    expect(isAnime(["Drama"], "ja")).toBe(false);
  });

  it("treats an unknown language as not anime", () => {
    expect(isAnime(["Animation"], null)).toBe(false);
  });
});
