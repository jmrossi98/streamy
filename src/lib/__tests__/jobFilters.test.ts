import { describe, expect, it } from "vitest";
import { isSoftwareRole, isUsRemote, matchMetro, matchMetros } from "../jobFilters";

describe("matchMetro", () => {
  it("matches the headline cities", () => {
    expect(matchMetro("New York, NY")?.key).toBe("nyc");
    expect(matchMetro("Chicago, IL")?.key).toBe("chicago");
    expect(matchMetro("Los Angeles, CA")?.key).toBe("la");
    expect(matchMetro("San Francisco, CA")?.key).toBe("bay");
    expect(matchMetro("Seattle, WA")?.key).toBe("seattle");
  });

  it("matches satellite cities, which is where most of the roles are", () => {
    // A posting says "Sunnyvale", never "Bay Area" -- filtering on the
    // headline city alone drops most of the metro.
    expect(matchMetro("Sunnyvale, CA")?.key).toBe("bay");
    expect(matchMetro("Mountain View, California")?.key).toBe("bay");
    expect(matchMetro("Bellevue, WA")?.key).toBe("seattle");
    expect(matchMetro("Culver City, CA")?.key).toBe("la");
  });

  it("is case and format insensitive", () => {
    expect(matchMetro("PALO ALTO")?.key).toBe("bay");
    expect(matchMetro("Office - New York")?.key).toBe("nyc");
  });

  it("does not match on state abbreviations", () => {
    // The reason patterns are city names only: "WA" is inside "Warsaw" and
    // "CA" inside "Canada", so an abbreviation pattern would match Europe.
    expect(matchMetro("Warsaw, Poland")).toBeNull();
    expect(matchMetro("Toronto, Canada")).toBeNull();
    expect(matchMetro("London, UK")).toBeNull();
  });

  it("returns null for somewhere not being watched", () => {
    expect(matchMetro("Austin, TX")).toBeNull();
    expect(matchMetro("Denver, CO")).toBeNull();
    expect(matchMetro("")).toBeNull();
  });
});

describe("isUsRemote", () => {
  it("accepts US and unqualified remote", () => {
    expect(isUsRemote("Remote - US")).toBe(true);
    expect(isUsRemote("Remote")).toBe(true);
  });

  it("rejects remote scoped to another region", () => {
    expect(isUsRemote("Remote - EMEA")).toBe(false);
    expect(isUsRemote("Remote (Canada)")).toBe(false);
    expect(isUsRemote("Remote - Europe")).toBe(false);
  });

  it("is not a metro match", () => {
    expect(isUsRemote("New York, NY")).toBe(false);
  });
});

describe("isSoftwareRole", () => {
  it("matches the usual spellings", () => {
    expect(isSoftwareRole("Software Engineer, Backend")).toBe(true);
    expect(isSoftwareRole("Senior Full Stack Developer")).toBe(true);
    expect(isSoftwareRole("Site Reliability Engineer")).toBe(true);
    expect(isSoftwareRole("Infrastructure Engineer")).toBe(true);
    expect(isSoftwareRole("Machine Learning Engineer")).toBe(true);
  });

  it("vetoes the other jobs that carry the word engineer", () => {
    // The whole reason for a veto list: these would otherwise bury the roles
    // actually being looked for.
    expect(isSoftwareRole("Sales Engineer")).toBe(false);
    expect(isSoftwareRole("Solutions Engineer, Enterprise")).toBe(false);
    expect(isSoftwareRole("Mechanical Engineer")).toBe(false);
    expect(isSoftwareRole("Technical Recruiter, Engineering")).toBe(false);
    expect(isSoftwareRole("Support Engineer")).toBe(false);
  });

  it("vetoes management, which is not the role being looked for", () => {
    expect(isSoftwareRole("Engineering Manager, Payments")).toBe(false);
    expect(isSoftwareRole("Director, Software Engineering")).toBe(false);
  });

  it("ignores titles with no engineering in them at all", () => {
    expect(isSoftwareRole("Account Executive")).toBe(false);
    expect(isSoftwareRole("Product Designer")).toBe(false);
    expect(isSoftwareRole("")).toBe(false);
  });

  it("puts the veto ahead of the match", () => {
    // "Sales Engineer, Platform" hits "engineer, " as well as the veto. The
    // veto has to win or the list is decorative.
    expect(isSoftwareRole("Sales Engineer, Platform")).toBe(false);
  });
});

describe("matchMetros", () => {
  it("returns every metro a multi-city posting covers", () => {
    // Real Stripe location strings. Returning only the first would hide a
    // role open in four watched cities from three of them.
    expect(matchMetros("Seattle, San Francisco, New York").map((m) => m.key)).toEqual([
      "nyc",
      "bay",
      "seattle",
    ]);
    expect(matchMetros("US-Chicago, US-New York").map((m) => m.key)).toEqual([
      "nyc",
      "chicago",
    ]);
    expect(
      matchMetros("New York, NY; San Francisco, CA; Seattle, WA; Chicago, IL").map((m) => m.key)
    ).toEqual(["nyc", "chicago", "bay", "seattle"]);
  });

  it("understands the abbreviated forms postings actually use", () => {
    // "NYC, Sea, SF, Tor" is a real listing. Word boundaries are what make
    // these short patterns safe to have at all.
    expect(matchMetros("NYC, Sea, SF, Tor").map((m) => m.key)).toEqual([
      "nyc",
      "bay",
      "seattle",
    ]);
  });

  it("does not let short patterns match inside other words", () => {
    // The risk that word boundaries exist to remove.
    expect(matchMetros("Seaford, Delaware").map((m) => m.key)).toEqual([]);
    expect(matchMetros("Dusseldorf")).toEqual([]);
    expect(matchMetros("Buffalo, NY")).toEqual([]);
  });

  it("returns nothing for somewhere unwatched", () => {
    expect(matchMetros("Dublin")).toEqual([]);
  });
});
