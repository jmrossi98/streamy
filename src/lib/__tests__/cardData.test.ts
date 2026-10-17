import { describe, expect, it } from "vitest";
import { toCardMovie, toCardShow } from "@/lib/cardData";

const credits = { cast: Array.from({ length: 80 }, (_, i) => ({ id: i, name: `Actor ${i}` })) };

describe("cardData", () => {
  it("drops credits and providers from a movie", () => {
    const detail = {
      id: "1",
      title: "Stalker",
      overview: "A guide leads two men.",
      poster: "p",
      backdrop: "b",
      year: "1979",
      rating: 8.1,
      duration: "2h 42m",
      genres: ["Drama"],
      runtime: 162,
      flatrate: [{ id: 1, name: "Max", logoPath: "x" }],
      credits,
    };
    const card = toCardMovie(detail);
    expect(card).not.toHaveProperty("credits");
    expect(card).not.toHaveProperty("flatrate");
    expect(card).toMatchObject({ id: "1", title: "Stalker", genres: ["Drama"], overview: "A guide leads two men." });
    expect(JSON.stringify(card).length).toBeLessThan(JSON.stringify(detail).length / 4);
  });

  it("keeps a show's season count and drops credits", () => {
    const card = toCardShow({
      id: "2",
      name: "Clone High",
      overview: "",
      poster: "p",
      backdrop: "b",
      year: "2002",
      rating: 7,
      genres: ["Animation", "Anime"],
      numberOfSeasons: 1,
      hasSpecials: false,
      credits,
    });
    expect(card).not.toHaveProperty("credits");
    expect(card).not.toHaveProperty("hasSpecials");
    expect(card.numberOfSeasons).toBe(1);
    expect(card.genres).toEqual(["Animation", "Anime"]);
  });
});
