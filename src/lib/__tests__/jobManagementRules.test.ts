import { describe, expect, it } from "vitest";
import {
  careerExperience,
  EXEC_RETRY_MS,
  execHiddenReason,
  extractExecRequirement,
  needsExecCheck,
  type ExecCheck,
} from "../jobManagementRules";
import { classifyLevel, classifyRole, managementKind } from "../jobFilters";

describe("managementKind", () => {
  it("keeps software and engineering managers", () => {
    for (const title of [
      "Engineering Manager",
      "Engineering Manager, Payments",
      "Software Engineering Manager",
      "Manager, Software Engineering",
      "Senior Engineering Manager, Infrastructure",
      "Manager of Engineering",
      "Software Development Manager, AWS",
      "Principal Engineering Manager",
      "Software Engineering Team Lead",
      "Software Engineering Team Leader (Engineering Manager) -Anomaly Platform",
    ]) {
      expect(managementKind(title), title).toBe("em");
    }
  });

  it("calls director, VP and head-of-engineering roles exec", () => {
    for (const title of [
      "Director of Engineering",
      "Director, Software Engineering",
      "Senior Director, Engineering",
      "VP of Engineering",
      "VP, Engineering",
      "Vice President, Software Engineering",
      "Head of Engineering",
    ]) {
      expect(managementKind(title), title).toBe("exec");
    }
  });

  it("leaves out managers of something other than software", () => {
    for (const title of [
      "Product Manager",
      "Technical Program Manager, Engineering",
      "Engineering Program Manager",
      "Sales Engineering Manager",
      "Customer Engineering Manager",
      "Hardware Engineering Manager",
      "Manufacturing Engineering Manager",
      "Risk Manager - Engineering - CRO",
      "Communications Manager, Engineering & Technology",
      "Product Delivery Manager - Engineering COO Office",
      "Director of Sales",
      "Director of Product",
      "Account Manager",
    ]) {
      expect(managementKind(title), title).toBeNull();
    }
  });

  it("does not take an engineer working on a 'management' product for a manager (live, 2026-10-24)", () => {
    for (const title of [
      "Software Engineer, Ads Manager",
      "Software Engineer, Fleet Management",
      "Systems Software Engineer, Management Plane",
      "Senior Software Engineer - Identity & Access Management",
      "Strategic Sourcing Manager, Engineering Technology & Software",
      "Director, Product Management - Data Transformation (Frontier Engineering)",
    ]) {
      expect(managementKind(title), title).toBeNull();
    }
    expect(classifyLevel("Software Engineer, Ads Manager")).toBe("midsenior");
    expect(managementKind("Member of Technical Staff, Engineering Manager")).toBe("em");
  });

  it("keeps tech leads under Lead / staff+, as Jake asked", () => {
    expect(managementKind("Tech Lead Manager, Ads")).toBeNull();
    expect(classifyLevel("Tech Lead Manager, Ads")).toBe("staff");
    expect(classifyLevel("Technical Lead, Payments")).toBe("staff");
  });

  it("does not take a bank's Vice President grade for an executive", () => {
    expect(managementKind("Software Engineer - Vice President")).toBeNull();
    expect(classifyRole("Software Engineer - Vice President")).toBeNull();
  });
});

describe("classify a management title", () => {
  it("files it under Management, in the category of what it manages", () => {
    expect(classifyLevel("Engineering Manager, Payments")).toBe("management");
    expect(classifyRole("Engineering Manager, Payments")).toBe("swe");
    expect(classifyRole("Machine Learning Engineering Manager")).toBe("ai");
    expect(classifyRole("Security Engineering Manager")).toBe("security");
    expect(classifyLevel("Director of Engineering")).toBe("management");
  });

  it("still vetoes a director of something else", () => {
    expect(classifyRole("Director of Product Marketing")).toBeNull();
    expect(classifyRole("Product Manager, Software Engineering Tools")).toBeNull();
  });
});

describe("extractExecRequirement", () => {
  it("reads the common phrasings", () => {
    expect(extractExecRequirement("10+ years of experience in software development").years).toBe(10);
    expect(extractExecRequirement("A minimum of 12 years of industry experience").years).toBe(12);
    expect(extractExecRequirement("at least eight years building distributed systems").years).toBe(8);
    expect(extractExecRequirement("ten (10) years of professional experience").years).toBe(10);
    expect(extractExecRequirement("5-7 years of software engineering experience").years).toBe(5);
  });

  it("takes the smallest bar, so preferred years don't raise it", () => {
    const text = `Minimum qualifications:
- BS + 12 years of software engineering experience, or MS + 10 years of experience.
Preferred qualifications:
- 15+ years of experience leading platform teams.`;
    expect(extractExecRequirement(text).years).toBe(10);
  });

  it("separates managing managers from overall experience", () => {
    const text = `- 8+ years of software engineering experience
- 4+ years of experience managing managers`;
    expect(extractExecRequirement(text)).toEqual({ years: 8, managerYears: 4 });
  });

  it("ties each number to its own words (live director listings, 2026-10-24)", () => {
    // Chime, Director Engineering.
    expect(
      extractExecRequirement(
        "10+ years of software engineering experience, including 5+ years managing managers or leading multi-team engineering organizations"
      )
    ).toEqual({ years: 10, managerYears: 5 });
    // Chime, Director, Growth Engineering.
    expect(
      extractExecRequirement(
        "10+ years in software engineering, including 5+ years leading teams and at least 2 years leading tech lead managers or other leaders"
      )
    ).toEqual({ years: 10, managerYears: 2 });
    // Clear, Director of Engineering: only a managing-managers bar.
    expect(
      extractExecRequirement("4+ years of leading and scaling engineering organizations, including managing managers and senior ICs")
    ).toEqual({ years: null, managerYears: 4 });
  });

  it("falls back to people-management years when nothing else is stated", () => {
    expect(extractExecRequirement("6+ years of people management experience").years).toBe(6);
    expect(extractExecRequirement("12 years of experience; 5 years of people management").years).toBe(12);
  });

  it("ignores company history and other non-requirements", () => {
    expect(extractExecRequirement("For over 40 years, we have built terminals.").years).toBeNull();
    expect(extractExecRequirement("Founded 12 years ago in New York.").years).toBeNull();
    expect(extractExecRequirement("Lead the roadmap for the next 3 years of growth.").years).toBeNull();
  });

  it("returns nulls for a listing that states no bar", () => {
    expect(extractExecRequirement("Lead our engineering organization.")).toEqual({ years: null, managerYears: null });
  });
});

describe("careerExperience", () => {
  const now = new Date("2026-10-24T00:00:00Z");

  it("counts from the first full-time role, not the internship or the degree", () => {
    const resume = `## Experience
### Capital One | Senior Software Engineer | Aug 2019 – Present
- Built real-time messaging services
### Acme | Software Engineering Intern | Sep 2018 – Dec 2018
- Mentored nobody
## Education
### Rochester Institute of Technology | B.S. Software Engineering | Aug 2014 – May 2019`;
    const exp = careerExperience([resume], now);
    expect(exp.careerStart?.toISOString().slice(0, 7)).toBe("2019-08");
    expect(exp.internshipStart?.toISOString().slice(0, 7)).toBe("2018-09");
    expect(exp.years).toBeCloseTo(7.2, 1);
  });

  it("reads a Word export with the title on the line above the dates", () => {
    const docx = `Capital One
Software Engineer
August 2019 - Present
Built a multi-agent assistant with an Angular UI, used by analysts across several teams every day.
Software Engineering Intern
09/2018 – 12/2018
University of Somewhere
Aug 2014 – May 2019`;
    const exp = careerExperience([docx], now);
    expect(exp.careerStart?.toISOString().slice(0, 7)).toBe("2019-08");
    expect(exp.internshipStart?.toISOString().slice(0, 7)).toBe("2018-09");
  });

  it("does not let a bullet about interns relabel the job", () => {
    const text = `Software Engineer
- Mentored two interns through their projects
Aug 2019 – Present`;
    expect(careerExperience([text], now).careerStart?.toISOString().slice(0, 7)).toBe("2019-08");
  });

  it("reads Jake's real layouts: a company tenure line, and the internship under another title", () => {
    // Shapes from the vault's resumes on 2026-10-24, which first gave 8.1 years.
    const current = `WORK EXPERIENCE

Mastodon Design LLC, a CACI Company               Sept 2018 – Present
Software Engineer II | Aug 2019 – Present    Rochester, NY
Individually maintained mission-critical backend microservices for the company's flagship product line.

Software Engineer Intern | Sept 2018 – Aug 2019
Developed full-stack feature improvements on a large-scale enterprise application.`;
    const old = `Mastodon Design LLC / Applications Developer
SEPT 2018 - PRESENT,  ROCHESTER, NY
Office Clerk / Thermo Fisher Scientific
JUNE 2018 - AUG 2018,  PENFIELD, NY`;
    const exp = careerExperience([current, old], now);
    expect(exp.careerStart?.toISOString().slice(0, 7)).toBe("2019-08");
    expect(exp.internshipStart?.toISOString().slice(0, 7)).toBe("2018-09");
    expect(exp.years).toBe(7.2);
  });

  it("returns null when no role date can be found", () => {
    expect(careerExperience(["Notes about the job, early 2025 – late 2026."], now).years).toBeNull();
  });
});

describe("execHiddenReason", () => {
  const read = (years: number | null, managerYears: number | null = null): ExecCheck => ({
    checkedAt: new Date(),
    status: "read",
    years,
    managerYears,
  });

  it("shows a role at or within a year of his experience", () => {
    expect(execHiddenReason(read(7), 7.2)).toBeNull();
    expect(execHiddenReason(read(8), 7.2)).toBeNull();
  });

  it("hides one that asks for more", () => {
    expect(execHiddenReason(read(10), 7.2)).toBe("Asks for 10+ years; you have 7.2");
    expect(execHiddenReason(read(8, 3), 7.2)).toBe("Asks for 3+ years managing managers");
  });

  it("hides what it cannot judge", () => {
    expect(execHiddenReason({ checkedAt: null, status: null, years: null, managerYears: null }, 7.2)).toMatch(/Checking/);
    expect(execHiddenReason({ ...read(null), status: "unread" }, 7.2)).toMatch(/Couldn't read/);
    expect(execHiddenReason(read(null), 7.2)).toMatch(/states no minimum/);
    expect(execHiddenReason(read(5), null)).toMatch(/experience couldn't be read/);
  });
});

describe("needsExecCheck", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  it("reads each listing once, and an unread one again a day later", () => {
    expect(needsExecCheck({ checkedAt: null, status: null, years: null, managerYears: null }, now)).toBe(true);
    const fresh = new Date(now.getTime() - 3600_000);
    const old = new Date(now.getTime() - EXEC_RETRY_MS);
    expect(needsExecCheck({ checkedAt: fresh, status: "read", years: 8, managerYears: null }, now)).toBe(false);
    expect(needsExecCheck({ checkedAt: old, status: "read", years: null, managerYears: null }, now)).toBe(false);
    expect(needsExecCheck({ checkedAt: fresh, status: "unread", years: null, managerYears: null }, now)).toBe(false);
    expect(needsExecCheck({ checkedAt: old, status: "unread", years: null, managerYears: null }, now)).toBe(true);
  });
});
