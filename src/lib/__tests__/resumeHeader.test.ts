import { describe, expect, it } from "vitest";
import {
  bareDomain,
  buildResumeMessages,
  buildReviewMessages,
  profileHeader,
  RESUME_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  withProfileHeader,
  type HeaderProfile,
} from "../resumeRules";

/**
 * 2026-10-24: generated resumes said "McLean, VA" and "Victor, NY", taken from
 * old resumes in the vault. The header now comes from the saved profile only.
 */
const profile: HeaderProfile = {
  firstName: "Jake",
  lastName: "Rossi",
  preferredName: "",
  email: "jake@example.com",
  phone: "555-0100",
  city: "Vienna",
  state: "VA",
  linkedin: "https://www.linkedin.com/in/jake/",
  github: "https://github.com/jake",
  website: "",
};

const modelResume = `# Jacob Rossi
jake@old.example | 555-9999 | McLean, VA | linkedin.com/in/old

## Experience
### Capital One, McLean, VA | Senior Software Engineer | Jan 2022 – Present
- Built things.

## Skills
- **Languages:** TypeScript`;

describe("resume header from the profile", () => {
  it("replaces whatever header the model wrote with the profile's", () => {
    const out = withProfileHeader(modelResume, profile);
    expect(out.split("\n").slice(0, 3)).toEqual([
      "# Jake Rossi",
      "jake@example.com | 555-0100 | Vienna, VA | linkedin.com/in/jake | github.com/jake",
      "",
    ]);
    expect(out).not.toContain("jake@old.example");
    expect(out).not.toContain("Victor");
    // A job's own location is part of the body and stays.
    expect(out).toContain("### Capital One, McLean, VA | Senior Software Engineer");
    expect(out.match(/^# /gm)).toHaveLength(1);
  });

  it("adds the header when the model followed the rule and wrote none", () => {
    const out = withProfileHeader("## Experience\n- x", profile);
    expect(out.startsWith("# Jake Rossi\njake@example.com")).toBe(true);
  });

  it("is the same whatever the model wrote", () => {
    const a = withProfileHeader(modelResume, profile);
    const b = withProfileHeader(modelResume.replace("McLean, VA |", "Victor, NY |"), profile);
    expect(a).toBe(b);
  });

  it("omits a missing field rather than guessing", () => {
    expect(profileHeader({ ...profile, phone: "", state: "", github: "", linkedin: "" })).toBe(
      "# Jake Rossi\njake@example.com | Vienna"
    );
    expect(profileHeader({ ...profile, city: "", state: "" })).not.toMatch(/VA|McLean/);
    expect(profileHeader({ ...profile, preferredName: "J.R." })).toMatch(/^# J\.R\. Rossi/);
  });

  it("writes links as bare domains", () => {
    expect(bareDomain("https://www.linkedin.com/in/jake/")).toBe("linkedin.com/in/jake");
    expect(bareDomain("github.com/jake")).toBe("github.com/jake");
  });

  it("tells both passes not to write a header, and gives the location as context", () => {
    expect(RESUME_SYSTEM_PROMPT).toMatch(/Do NOT write the name or contact line/);
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/No "# Name" heading and no contact line/);
    const posting = { company: "Meta", title: "SWE", location: "Remote", url: "u", postingText: "x", candidateLocation: "Vienna, VA" };
    const [, draftUser] = buildResumeMessages(posting, []);
    const [, reviewUser] = buildReviewMessages(posting, [], { resume: "## Experience", notes: "" });
    expect(draftUser.content).toContain("CANDIDATE: lives in Vienna, VA");
    expect(reviewUser.content).toContain("CANDIDATE: lives in Vienna, VA");
  });
});
