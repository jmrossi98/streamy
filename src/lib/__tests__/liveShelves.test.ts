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
    expect(key("SEC Network")).toBe("college-football");
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

describe("sports rows", () => {
  it("files the lineup's sports channels in their rows", () => {
    const rows: Record<string, string[]> = {
      nfl: ["NFL BUFFALO BILLS", "NFL FOX EAGLES PHILADELPHIA PA", "NFL CBS RAVENS BALTIMORE MD", "NFL CHANNEL", "NFL CBS BILLS GIANTS JETS NEW YORK NY"],
      nba: ["NBA PHILADELPHIA 76ERS", "NBA LEAGUE PASS 1", "NBA: NEW YORK KNICKS (NYK) ᴴᴰ", "NBA TV HD"],
      nhl: ["NHL BUFFALO SABRES", "NHL WASHINGTON CAPITALS", "NHL SAN JOSE SHARKS", "Sharks at Predators (NHL Live)"],
      soccer: ["BEIN SPORTS HD", "BEIN SPORTS 2 HD", "FOX SOCCER PLUS", "TUDN", "ESPN DEPORTES", "FOX DEPORTES", "GOL TV HD", "CBS SPORTS GOLAZO NETWORK"],
      combat: ["UFC 24/7", "UFC HD", "UFC EVENT", "UFC PPV MAIN EVENT", "FIGHT NETWORK HD", "WWE HD", "BOXING", "DAZN COMBAT"],
      f1: ["F1 TV MAIN ENGLISH", "SKY SPORTS F1 HD", "F1 TV", "FORMULA 1 CHANNEL"],
      "college-football": ["SEC NETWORK HD", "BIG TEN NETWORK HD", "ACC NETWORK HD", "CBS SPORTS NETWORK HD", "ESPNU"],
      "college-basketball": ["NCAAB 01", "NCAAB 04", "College Basketball on ESPN"],
      mlb: ["MLB NETWORK", "MLB STRIKE ZONE HD", "YES NETWORK HD", "MLB NEW YORK YANKEES HD", "MLB BALTIMORE ORIOLES HD", "MLB TORONTO BLUE JAYS HD"],
      sports: ["MONUMENTAL SPORTS NETWORK HD", "NBC SPORTS CALIFORNIA", "MSG New York", "NBC Sports Philadelphia"],
    };
    for (const [row, names] of Object.entries(rows)) {
      for (const n of names) expect([n, key(n)]).toEqual([n, row]);
    }
  });

  it("lets a named league beat another league's nickname", () => {
    expect(key("MLB SAN FRANCISCO GIANTS HD")).toBe("mlb");
    expect(key("MLB ST. LOUIS CARDINALS HD")).toBe("mlb");
    expect(key("NHL TEAM| FLORIDA PANTHERS")).toBe("nhl");
    expect(key("NHL TEAM| WINNIPEG JETS")).toBe("nhl");
    expect(key("NBA TEAM| SACRAMENTO KINGS")).toBe("nba");
  });

  it("lets college and fight names beat team nicknames", () => {
    expect(key("NCAAF 49: Boston College at Pittsburgh Panthers")).toBe("college-football");
    expect(key("UFC Fight Night: Jets Arena")).toBe("combat");
  });

  it("titles the new rows", () => {
    expect(shelfFor("MLB NETWORK").title).toBe("Baseball");
    expect(shelfFor("F1 TV").title).toBe("F1");
    expect(shelfFor("ESPNU").title).toBe("College Football");
    expect(shelfFor("NCAAB 01").title).toBe("College Basketball");
  });

  it("puts the new rows after the leagues and before More Sports", () => {
    const rows = groupIntoShelves(
      ["ESPN", "MLB NETWORK", "NCAAB 01", "ESPNU", "F1 TV", "UFC HD", "BEIN SPORTS", "NHL NETWORK", "NBA TV", "NFL CHANNEL"].map((name) => ({ name })),
    );
    expect(rows.map((r) => r.shelf.key)).toEqual(["nfl", "nba", "nhl", "soccer", "combat", "f1", "college-football", "college-basketball", "mlb", "sports"]);
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
