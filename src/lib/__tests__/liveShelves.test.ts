import { describe, it, expect } from "vitest";
import { groupIntoShelves, shelfFor } from "../liveShelves";

const key = (n: string) => shelfFor(n).key;

describe("shelfFor", () => {
  it("files league channels and team game feeds under their league", () => {
    expect(key("Sharks vs Predators (Sharks Broadcast)")).toBe("nhl");
    expect(key("NHL SAN JOSE SHARKS")).toBe("nhl");
    expect(key("SP - NHL NETWORK HD")).toBe("nhl");
    expect(key("NFL RedZone")).toBe("nfl");
    expect(key("US: Los Angeles Lakers")).toBe("nba");
    expect(key("MLB Network")).toBe("mlb");
    expect(key("SEC Network")).toBe("college");
    expect(key("beIN SPORTS")).toBe("soccer");
    expect(key("UFC Fight Pass")).toBe("combat");
  });

  it("puts general sports networks after the leagues", () => {
    expect(key("NBC Sports Bay Area")).toBe("sports");
    expect(key("ESPN2")).toBe("sports");
  });

  it("files the genres", () => {
    expect(key("MeTV")).toBe("classics");
    expect(key("Cartoon Network")).toBe("kids");
    expect(key("ABC 7 News")).toBe("news");
    expect(key("CBS 13 Baltimore")).toBe("network");
    expect(key("70s Cinema (720p)")).toBe("classics");
    expect(key("HBO")).toBe("movies");
    expect(key("Burbank Channel")).toBe("other");
  });
});

describe("groupIntoShelves", () => {
  it("orders rows sports-first and leaves empty ones out", () => {
    const rows = groupIntoShelves([{ name: "MeTV" }, { name: "NHL NETWORK" }, { name: "ESPN" }, { name: "Burbank Channel" }]);
    expect(rows.map((r) => r.shelf.key)).toEqual(["nhl", "sports", "classics", "other"]);
  });
});

describe("call signs", () => {
  it("are Network only when written as call signs", () => {
    expect(key("USA - WJZ Baltimore")).toBe("network");
    expect(key("KTVU")).toBe("network");
    expect(key("Wave Surf TV")).toBe("other");
  });
});
