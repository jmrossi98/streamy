import { describe, expect, it, vi } from "vitest";
import { isAnime, tagAnime, withAnimeGenre } from "@/lib/animeRules";

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

describe("withAnimeGenre", () => {
  it("adds Anime once", () => {
    expect(withAnimeGenre(["Animation"], "ja")).toEqual(["Animation", "Anime"]);
    expect(withAnimeGenre(["Animation", "Anime"], "ja")).toEqual(["Animation", "Anime"]);
    expect(withAnimeGenre(["Animation"], "en")).toEqual(["Animation"]);
  });
});

describe("tagAnime", () => {
  it("looks up the language of animated shows only", async () => {
    const lang = vi.fn(async (id: string) => (id === "1" ? "ja" : "en"));
    const out = await tagAnime(
      [
        { id: "1", genres: ["Animation"] },
        { id: "2", genres: ["Animation"] },
        { id: "3", genres: ["Drama"] },
      ],
      lang
    );
    expect(out.map((s) => s.genres)).toEqual([["Animation", "Anime"], ["Animation"], ["Drama"]]);
    expect(lang).toHaveBeenCalledTimes(2);
  });
});
