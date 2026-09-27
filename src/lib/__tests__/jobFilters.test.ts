import { describe, expect, it } from "vitest";
import { classifyLevel, classifyRole, isSoftwareRole, isUsRemote, matchMetro, matchMetros } from "../jobFilters";

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

describe("classifyRole", () => {
  it("recognises the categories that are not called software engineering", () => {
    // The whole reason categories exist: none of these say "software
    // engineer", and all of them are the job.
    expect(classifyRole("Quantitative Researcher")).toBe("quant");
    expect(classifyRole("Quantitative Developer, Systematic Trading")).toBe("quant");
    expect(classifyRole("Firmware Engineer, Storage")).toBe("lowlevel");
    expect(classifyRole("Embedded Software Engineer")).toBe("lowlevel");
    expect(classifyRole("Linux Kernel Engineer")).toBe("lowlevel");
    expect(classifyRole("Compiler Engineer")).toBe("lowlevel");
    expect(classifyRole("Application Security Engineer")).toBe("security");
    expect(classifyRole("Detection Engineering Lead")).toBe("security");
  });

  it("prefers the specific bucket over the generic one", () => {
    // "Security Software Engineer" is honestly both. The specific one wins, or
    // the security filter would be missing most of what belongs in it.
    expect(classifyRole("Security Software Engineer")).toBe("security");
    expect(classifyRole("Embedded Software Engineer, Firmware")).toBe("lowlevel");
    expect(classifyRole("Machine Learning Engineer")).toBe("ai");
    expect(classifyRole("Site Reliability Engineer")).toBe("infra");
    expect(classifyRole("iOS Engineer")).toBe("mobile");
    expect(classifyRole("Graphics Engineer")).toBe("graphics");
  });

  it("falls back to software for an ordinary engineering title", () => {
    expect(classifyRole("Software Engineer, Backend")).toBe("swe");
    expect(classifyRole("Senior Full Stack Developer")).toBe("swe");
    expect(classifyRole("Member of Technical Staff")).toBe("swe");
  });

  it("still vetoes the jobs that merely borrow the words", () => {
    expect(classifyRole("Sales Engineer")).toBeNull();
    expect(classifyRole("Mechanical Engineer")).toBeNull();
    expect(classifyRole("Technical Recruiter, Engineering")).toBeNull();
    expect(classifyRole("Engineering Manager, Payments")).toBeNull();
    // "security" and "quant" have their own impostors.
    expect(classifyRole("Security Guard")).toBeNull();
    expect(classifyRole("Quantitative UX Researcher")).toBeNull();
  });

  it("agrees with isSoftwareRole, which is now just the yes/no", () => {
    for (const title of ["Firmware Engineer", "Sales Engineer", "Quantitative Researcher"]) {
      expect(isSoftwareRole(title)).toBe(classifyRole(title) !== null);
    }
  });
});

describe("classifyRole: the shapes Jake asked to be sure of", () => {
  it("catches the ordinary web-stack titles", () => {
    for (const title of [
      "Full Stack Engineer",
      "Backend Engineer, Payments",
      "Frontend Engineer",
      "Front-End Developer",
      "Application Engineer",
      "Applications Developer",
      "Product Engineer",
      "Web Engineer",
    ]) {
      expect(classifyRole(title)).toBe("swe");
    }
  });

  it("gives AI its own bucket, separate from data plumbing", () => {
    // Building models and building the pipelines that feed them are different
    // jobs; one filter for both was useless for either.
    expect(classifyRole("AI Engineer")).toBe("ai");
    expect(classifyRole("Research Engineer, LLM Inference")).toBe("ai");
    expect(classifyRole("Applied Scientist, Generative AI")).toBe("ai");
    expect(classifyRole("Computer Vision Engineer")).toBe("ai");
    expect(classifyRole("Data Engineer")).toBe("data");
    expect(classifyRole("Analytics Engineer")).toBe("data");
  });

  it("catches graphics work", () => {
    expect(classifyRole("Graphics Engineer")).toBe("graphics");
    expect(classifyRole("Rendering Engineer, Engine")).toBe("graphics");
    expect(classifyRole("Gameplay Engineer")).toBe("graphics");
    expect(classifyRole("GPU Engineer")).toBe("graphics");
  });
});

describe("classifyRole: short tokens and forward-deployed", () => {
  it("matches ML as a word, not inside another one", () => {
    expect(classifyRole("ML Engineer, Ranking")).toBe("ai");
    expect(classifyRole("AI/ML Engineer")).toBe("ai");
    // The reason boundaries are needed at all.
    expect(classifyRole("HTML Email Designer")).toBeNull();
  });

  it("gives forward-deployed work its own bucket", () => {
    // Real Stripe title. Above swe in the order, or it just reads as software.
    expect(classifyRole("Forward Deployed Engineer, Privy")).toBe("fde");
    expect(classifyRole("Forward-Deployed Software Engineer")).toBe("fde");
  });

  it("still matches the long SDE/SWE abbreviations as words", () => {
    expect(classifyRole("SDE II, Storage")).toBe("swe");
    expect(classifyRole("SWE, Core")).toBe("swe");
    expect(classifyRole("Site Reliability Engineer (SRE)")).toBe("infra");
  });
});

describe("classifyRole: data", () => {
  it("keeps science and engineering in one bucket", () => {
    // Different jobs, but not different enough to be worth two filters: both
    // are what someone scanning for data work wants to see.
    expect(classifyRole("Data Scientist, Growth")).toBe("data");
    expect(classifyRole("Research Scientist, Ranking")).toBe("data");
    expect(classifyRole("Decision Scientist")).toBe("data");
    expect(classifyRole("Data Engineer")).toBe("data");
    expect(classifyRole("Analytics Engineer")).toBe("data");
  });

  it("does not swallow the AI bucket", () => {
    // "Applied Scientist" is an ML title at most big tech firms, so it has to
    // stay in AI rather than being caught by the scientist patterns.
    expect(classifyRole("Applied Scientist, Generative AI")).toBe("ai");
    expect(classifyRole("Machine Learning Engineer")).toBe("ai");
  });
});

describe("classifyLevel", () => {
  it("reads the entry-level markers", () => {
    expect(classifyLevel("Software Engineer Intern, Mobile (Winter 2027)")).toBe("entry");
    expect(classifyLevel("Software Engineer, New Grad (Dec 2026)")).toBe("entry");
    expect(classifyLevel("Junior Developer")).toBe("entry");
    expect(classifyLevel("Early Career Software Engineer")).toBe("entry");
  });

  it("puts staff above senior when a title claims both", () => {
    // "Senior Staff Engineer" is staff, not senior. Order is the tie-break.
    expect(classifyLevel("Senior Staff Software Engineer")).toBe("staff");
    expect(classifyLevel("Principal Engineer")).toBe("staff");
    expect(classifyLevel("Tech Lead, Payments")).toBe("staff");
    expect(classifyLevel("Distinguished Engineer")).toBe("staff");
  });

  it("treats an unmarked title as mid/senior", () => {
    // A convention, not a fact: a plain "Software Engineer" is an ordinary IC
    // posting nearly everywhere, and a fourth bucket would hold most rows.
    expect(classifyLevel("Software Engineer")).toBe("midsenior");
    expect(classifyLevel("Senior Software Engineer")).toBe("midsenior");
    expect(classifyLevel("Backend Engineer II")).toBe("midsenior");
  });
});
