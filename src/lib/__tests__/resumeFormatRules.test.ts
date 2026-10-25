import { describe, expect, it } from "vitest";
import {
  checkResumeFormat,
  classifyRoleType,
  countWords,
  formatIssuesBlock,
  parseResume,
  parseResumeRules,
  pickVoiceExemplars,
  sentences,
  technologiesIn,
} from "../resumeFormatRules";
import { guidancePaths, isBankFile, voiceSourcePaths } from "../resumeBankRules";
import { isWritableVaultPath } from "../sharedVaultRules";

/** A bullet of exactly n words, with a result up front. */
const words = (n: number, lead = "Cut") => [lead, ...Array.from({ length: n - 1 }, (_, i) => `w${i}`)].join(" ");

function resume({
  current = 5,
  previous = 4,
  intern = 1,
  projects = 0,
  bulletWords = 18,
  summary = "",
  skills = "Python, TypeScript, AWS Lambda, DynamoDB, PostgreSQL, React, Docker, Kafka, Terraform",
}: Partial<{ current: number; previous: number; intern: number; projects: number; bulletWords: number; summary: string; skills: string }> = {}) {
  const b = (n: number) => Array.from({ length: n }, () => `- ${words(bulletWords)}`).join("\n");
  return [
    summary ? `## Summary\n${summary}\n` : "",
    "## Experience",
    "### Capital One | Senior Software Engineer | Aug 2022 – Present",
    b(current),
    "### Capital One | Software Engineer | Aug 2019 – Jul 2022",
    b(previous),
    "### Acme | Software Engineering Intern | Sep 2018 – Dec 2018",
    b(intern),
    projects ? `## Projects\n### Streamy | Next.js | 2026\n${b(projects)}` : "",
    "## Skills",
    `- **Languages:** ${skills}`,
    "## Education",
    "### RIT | B.S. Software Engineering | May 2019",
  ].join("\n");
}

describe("parseResume", () => {
  it("reads entries, bullets, the internship, skills and summary", () => {
    const r = parseResume(resume({ summary: "Led 3 teams." }));
    expect(r.experience.map((e) => e.bullets.length)).toEqual([5, 4, 1]);
    expect(r.experience.map((e) => e.internship)).toEqual([false, false, true]);
    expect(r.skills).toHaveLength(9);
    expect(r.summary).toBe("Led 3 teams.");
  });
});

describe("countWords and sentences", () => {
  it("counts the way a reader does", () => {
    expect(countWords("Cut p99 latency 40% on Node.js services, real-time.")).toBe(8);
    expect(countWords("**Bold** words count `once`")).toBe(4);
    expect(countWords("  ")).toBe(0);
  });

  it("does not split on Node.js or e.g.", () => {
    expect(sentences("Built Node.js APIs, e.g. billing. Cut costs 20%.")).toHaveLength(2);
  });
});

describe("technologiesIn", () => {
  it("counts AWS Lambda once, not as AWS plus Lambda", () => {
    expect(technologiesIn("Built AWS Lambda handlers on DynamoDB").sort()).toEqual(["AWS Lambda", "DynamoDB"]);
  });

  it("ignores prose that looks like a short name", () => {
    expect(technologiesIn("Helped the team go faster, and can ship weekly")).toEqual([]);
  });

  it("adds the resume's own skills", () => {
    expect(technologiesIn("Moved jobs to Temporal", ["Temporal"])).toEqual(["Temporal"]);
  });
});

describe("checkResumeFormat", () => {
  const trims = (md: string, type = "product" as const) =>
    checkResumeFormat(md, type).filter((i) => i.severity === "trim").map((i) => i.message);

  it("passes a resume inside every limit", () => {
    expect(trims(resume())).toEqual([]);
  });

  it("names the role over its bullet budget", () => {
    const out = trims(resume({ current: 7, previous: 7 }));
    expect(out.some((m) => m.startsWith("Current role (Capital One, Senior Software Engineer) has 7 bullets"))).toBe(true);
    expect(out.some((m) => m.startsWith("Previous role (Capital One, Software Engineer) has 7 bullets"))).toBe(true);
    expect(out.some((m) => m.startsWith("17 bullets in total"))).toBe(false);
  });

  it("counts the total, internship and projects", () => {
    const out = trims(resume({ current: 6, previous: 5, intern: 3, projects: 3 }));
    expect(out.some((m) => /^17 bullets in total; the limit is 16\. Cut 1/.test(m))).toBe(true);
    expect(out.some((m) => m.startsWith("Internship"))).toBe(true);
    expect(out.some((m) => m.startsWith("Project"))).toBe(true);
  });

  it("doesn't ask for more bullets than the per-role caps allow", () => {
    // Three roles, no projects: 6 + 6 + 1 = 13 is the most there can be.
    const full = checkResumeFormat(resume({ current: 6, previous: 6, intern: 1 }), "product");
    expect(full.some((i) => /bullets in total/.test(i.message))).toBe(false);
    const short = checkResumeFormat(resume({ current: 5, previous: 4, intern: 1 }), "product");
    expect(short.some((i) => /^10 bullets in total; aim for 14-16/.test(i.message))).toBe(true);
  });

  it("gives leadership resumes a 7th current-role bullet and no projects", () => {
    // 7 + 6 + 1 = 14 with no projects.
    const lead = checkResumeFormat(resume({ current: 7, previous: 6, intern: 1 }), "leadership");
    expect(lead.filter((i) => i.severity === "trim")).toEqual([]);
    expect(lead.some((i) => /bullets in total/.test(i.message))).toBe(false);
    const thirteen = checkResumeFormat(resume({ current: 6, previous: 6, intern: 1 }), "leadership");
    expect(thirteen.some((i) => /^13 bullets in total; aim for 14-16/.test(i.message))).toBe(true);
    const seven = checkResumeFormat(resume({ current: 7 }), "product");
    expect(seven.some((i) => i.severity === "trim" && /^Current role .* has 7 bullets/.test(i.message))).toBe(true);
    const withProject = checkResumeFormat(resume({ current: 7, previous: 6, intern: 1, projects: 1 }), "leadership");
    expect(withProject.some((i) => i.severity === "trim" && /remove the Projects section/.test(i.message))).toBe(true);
  });

  it("does not count REST as a technology", () => {
    expect(technologiesIn("Reduced latency 40% on a REST API (Python/Django, PostgreSQL)").sort()).toEqual(["Django", "PostgreSQL", "Python"]);
  });

  it("names each bullet over 25 words, with its words", () => {
    const md = resume().replace(`- ${words(18)}`, `- ${words(31, "Reduced")}`);
    const out = trims(md);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Capital One, Senior Software Engineer, bullet 1 \("Reduced w0 w1/);
    expect(out[0]).toMatch(/is 31 words; trim to 25/);
  });

  it("flags a second sentence with no metric, but allows one that lands a number", () => {
    const md = (second: string) => resume().replace(`- ${words(18)}`, `- Shipped the enrollment feature to every account user across the bank. ${second}`);
    expect(trims(md("It was well received by everyone."))[0]).toMatch(/second sentence carries no metric/);
    expect(trims(md("Cut servicing calls 20%."))).toEqual([]);
  });

  it("caps technologies per bullet and catches a repeated stack", () => {
    const four = "- Built services in Python, TypeScript, Kafka and PostgreSQL for billing teams across the bank";
    const stackA = "- Built billing services on AWS Lambda and DynamoDB serving millions of customers each day";
    const stackB = "- Moved notification jobs onto AWS Lambda and DynamoDB, cutting the monthly bill noticeably";
    const md = resume({ current: 3 }).replace("## Experience\n### Capital One | Senior Software Engineer | Aug 2022 – Present", `## Experience\n### Capital One | Senior Software Engineer | Aug 2022 – Present\n${four}\n${stackA}\n${stackB}`);
    const out = trims(md);
    expect(out.some((m) => /names 4 technologies \(.*\); at most 3/.test(m))).toBe(true);
    expect(out.some((m) => /bullet 3 .* repeats the stack AWS Lambda \+ DynamoDB from .*bullet 2/.test(m))).toBe(true);
  });

  it("holds Skills to 8-12 items", () => {
    const many = Array.from({ length: 14 }, (_, i) => `Skill${i}`).join(", ");
    expect(trims(resume({ skills: many })).some((m) => /^Skills lists 14 items/.test(m))).toBe(true);
  });

  it("wants a summary only for leadership, with one figure", () => {
    const withSummary = resume({ summary: "Senior engineer leading messaging systems for the bank's card servicing platform." });
    expect(checkResumeFormat(withSummary, "product").some((i) => /non-leadership target/.test(i.message))).toBe(true);
    expect(trims(withSummary, "leadership" as never).some((m) => /no concrete figure/.test(m))).toBe(true);
    expect(checkResumeFormat(resume(), "leadership").some((i) => /Leadership target with no summary/.test(i.message))).toBe(true);
  });

  it("formats the block the review is given", () => {
    const block = formatIssuesBlock(checkResumeFormat(resume({ current: 7 }), "product"));
    expect(block).toMatch(/^FORMAT CHECK/);
    expect(block).toMatch(/- MUST: Current role/);
    expect(formatIssuesBlock([])).toBe("");
  });
});

describe("classifyRoleType", () => {
  it("sorts postings by how much depth they warrant", () => {
    expect(classifyRoleType("Software Engineer, Technical Leadership")).toBe("leadership");
    expect(classifyRoleType("Engineering Manager, Payments")).toBe("leadership");
    expect(classifyRoleType("Director of Engineering")).toBe("leadership");
    expect(classifyRoleType("Software Engineer, Systems")).toBe("systems");
    expect(classifyRoleType("Embedded Software Engineer")).toBe("systems");
    expect(classifyRoleType("Senior Software Engineer, Payments")).toBe("senior");
    expect(classifyRoleType("Full Stack Engineer")).toBe("product");
    expect(classifyRoleType("Product Manager")).toBe("product");
  });
});

describe("parseResumeRules", () => {
  it("numbers every bullet under a section, skipping the preamble and empty sections", () => {
    const md = `# Resume rules

General rules. One rule per bullet.
- not a rule: above the first section

## Clarifications
- Call it an "account identification bug".
- Backend work is real-time messaging.

## Never claim

## Always
- One page.
`;
    expect(parseResumeRules(md)).toEqual([
      { id: "R1", section: "Clarifications", text: 'Call it an "account identification bug".' },
      { id: "R2", section: "Clarifications", text: "Backend work is real-time messaging." },
      { id: "R3", section: "Always", text: "One page." },
    ]);
  });
});

describe("guidance files", () => {
  it("keeps the rules and style guide out of the experience bank", () => {
    expect(isBankFile("main/resume/resume-rules.md")).toBe(false);
    expect(isBankFile("main/resume/resume-style-guide.md")).toBe(false);
    expect(isBankFile("main/resume/capital-one/capital_one_accomplishments.md")).toBe(true);
    expect(guidancePaths("resume-rules.md")).toEqual(["main/resume/resume-rules.md", "resume/resume-rules.md"]);
  });

  it("lets Streamy write the rules note and nothing else in the resume folders", () => {
    for (const p of guidancePaths("resume-rules.md")) expect(isWritableVaultPath(p)).toBe(true);
    expect(isWritableVaultPath("main/resume/resume-style-guide.md")).toBe(false);
    expect(isWritableVaultPath("main/resume/notes.md")).toBe(false);
  });

  it("finds the voice resumes wherever the resume folder is", () => {
    const paths = [
      "main/resume/jakob_rossi_resume.docx",
      "main/resume/mastodon-results/jakob_rossi_resume_02_17_2025.docx",
      "main/resume/old/jakob_rossi_resume_01_01_2023.docx",
    ];
    expect(voiceSourcePaths(paths)).toEqual(paths.slice(0, 2));
    expect(voiceSourcePaths([])).toEqual([]);
  });
});

describe("pickVoiceExemplars", () => {
  it("takes bullet-shaped lines with numbers, evenly from each resume", () => {
    const a = `Jakob Rossi
Capital One
Owned mission-critical backend microservices including Python/Django REST APIs and PostgreSQL databases. Reduced API response times by 40% through query optimization.
Worked on things.
Developed internal tools for the operations team that made their daily reporting easier to run and review.`;
    const b = `Skills: Python, Go
Shipped a self-service feature on the enterprise TypeScript/Angular interface used by millions of customers. Reduced agent servicing calls by 20%.`;
    const out = pickVoiceExemplars([a, b], 4);
    expect(out[0]).toMatch(/^Owned mission-critical/);
    expect(out).toContain(
      "Shipped a self-service feature on the enterprise TypeScript/Angular interface used by millions of customers. Reduced agent servicing calls by 20%."
    );
    expect(out.some((l) => l.startsWith("Worked on"))).toBe(false);
    expect(out.length).toBeLessThanOrEqual(4);
  });
});
