import { describe, expect, it } from "vitest";
import { backdropSrcSet, cardArt } from "../tmdbImageRules";

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

describe("cardArt", () => {
  const poster = "https://image.tmdb.org/t/p/w500/poster.jpg";

  it("fills a card with the card-sized backdrop", () => {
    expect(cardArt("https://image.tmdb.org/t/p/original/abc.jpg", poster)).toEqual({
      src: "https://image.tmdb.org/t/p/w780/abc.jpg",
      srcSet: "https://image.tmdb.org/t/p/w300/abc.jpg 300w, https://image.tmdb.org/t/p/w780/abc.jpg 780w",
      fit: "cover",
    });
  });
  it("shows the whole poster when there is no backdrop", () => {
    expect(cardArt("https://placehold.co/1920x1080/1a1a1a/444?text=No+Backdrop", poster)).toEqual({
      src: poster,
      fit: "contain",
    });
  });
});
