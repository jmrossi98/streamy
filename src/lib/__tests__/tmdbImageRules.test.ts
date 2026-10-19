import { describe, expect, it } from "vitest";
import { backdropSrcSet } from "../tmdbImageRules";

describe("backdropSrcSet", () => {
  it("offers TMDB's phone, laptop and full sizes", () => {
    expect(backdropSrcSet("https://image.tmdb.org/t/p/original/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w780/abc.jpg 780w, https://image.tmdb.org/t/p/w1280/abc.jpg 1280w, https://image.tmdb.org/t/p/original/abc.jpg 3840w"
    );
  });
  it("has nothing to offer for a placeholder or an already-sized image", () => {
    expect(backdropSrcSet("https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop")).toBeUndefined();
    expect(backdropSrcSet("https://image.tmdb.org/t/p/w1280/abc.jpg")).toBeUndefined();
  });
});
