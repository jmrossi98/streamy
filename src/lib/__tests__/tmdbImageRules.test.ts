import { describe, expect, it } from "vitest";
import { artSrcSet, backdropSrcSet } from "../tmdbImageRules";

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

describe("artSrcSet", () => {
  it("re-sizes a poster handed out at w500 across TMDB's poster widths", () => {
    expect(artSrcSet("https://image.tmdb.org/t/p/w500/p.jpg", "poster")).toBe(
      "https://image.tmdb.org/t/p/w185/p.jpg 185w, https://image.tmdb.org/t/p/w342/p.jpg 342w, https://image.tmdb.org/t/p/w500/p.jpg 500w, https://image.tmdb.org/t/p/w780/p.jpg 780w"
    );
  });
  it("offers a headshot at w185 and h632", () => {
    expect(artSrcSet("https://image.tmdb.org/t/p/w185/face.jpg", "profile")).toBe(
      "https://image.tmdb.org/t/p/w185/face.jpg 185w, https://image.tmdb.org/t/p/h632/face.jpg 421w"
    );
  });
  it("re-sizes a still whatever size it was handed out at", () => {
    expect(artSrcSet("https://image.tmdb.org/t/p/original/s.jpg", "still")).toBe(
      "https://image.tmdb.org/t/p/w185/s.jpg 185w, https://image.tmdb.org/t/p/w300/s.jpg 300w"
    );
  });
  it("leaves placeholders and other hosts alone", () => {
    expect(artSrcSet("https://placehold.co/400x600/1a1a1a/666?text=No+Poster", "poster")).toBeUndefined();
    expect(artSrcSet("https://cdn2.steamgriddb.com/grid/abc.png", "poster")).toBeUndefined();
  });
  it("treats a backdrop like backdropSrcSet does", () => {
    expect(artSrcSet("https://image.tmdb.org/t/p/w1280/abc.jpg", "backdrop")).toBeUndefined();
    expect(artSrcSet("https://image.tmdb.org/t/p/original/abc.jpg", "backdrop")).toContain("w780/abc.jpg 780w");
  });
});
