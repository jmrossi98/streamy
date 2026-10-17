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
    expect(key("Cartoon Network")).toBe("cartoons");
    expect(key("ABC 7 News")).toBe("news");
    expect(key("CBS 13 Baltimore")).toBe("network");
    expect(key("70s Cinema (720p)")).toBe("classics");
    expect(key("HBO")).toBe("movies");
    expect(key("Burbank Channel")).toBe("other");
  });

  it("files the provider's names for the genre channels in their rows", () => {
    const rows: Record<string, string[]> = {
      cartoons: ["CARTOON NETWORK HD", "NICK JR HD", "NICKTOONS", "DISNEY CHANNEL HD", "DISNEY JR HD", "DISNEY XD HD", "BOOMERANG HD", "ADULT SWIM HD"],
      classics: ["MeTV", "TV LAND HD", "ANTENNA TV", "COZI", "CATCHY COMEDY"],
      news: ["CNN HD", "FOX NEWS HD", "MS NOW HD", "CNBC HD", "THE WEATHER CHANNEL HD", "BBC WORLD NEWS"],
      movies: ["AMC HD", "TCM HD", "FX HD", "HBO HD", "SHOWTIME HD", "STARZ HD"],
      music: ["MTV HD", "MTV LIVE HD", "CMT HD", "BET HD"],
      lifestyle: ["FOOD NETWORK HD", "HGTV HD", "DISCOVERY HD", "HISTORY HD", "NAT GEO HD", "COMEDY CENTRAL HD", "TLC HD"],
    };
    for (const [row, names] of Object.entries(rows)) {
      for (const n of names) expect([n, key(n)]).toEqual([n, row]);
    }
  });

  it("titles the cartoon row just Cartoons", () => {
    expect(shelfFor("Cartoon Network").title).toBe("Cartoons");
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
