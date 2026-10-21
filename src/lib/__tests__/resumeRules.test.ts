import { describe, expect, it } from "vitest";
import { buildResumeMessages, MAX_BANK_CHARS, resumeFileName, splitResumeOutput, buildReviewMessages } from "../resumeRules";

const posting = {
  company: "Stripe",
  title: "Software Engineer, Payments",
  location: "Seattle",
  url: "https://stripe.com/jobs/1",
  postingText: "We want Go and distributed systems.",
};

describe("buildResumeMessages", () => {
  it("carries the listing, the bank, and the truthfulness rule", () => {
    const [system, user] = buildResumeMessages(posting, [{ path: "Resume/Master Resume.md", text: "Built X." }]);
    expect(system.content).toMatch(/Never invent or embellish/);
    expect(user.content).toContain("Company: Stripe");
    expect(user.content).toContain("We want Go");
    expect(user.content).toContain("--- Resume/Master Resume.md ---");
  });

  it("lets the model pick among documented titles per listing, never an invented one", () => {
    const [system] = buildResumeMessages(posting, []);
    expect(system.content).toMatch(/TITLES/);
    expect(system.content).toMatch(/Every title the bank documents for that job is fair to use/);
    expect(system.content).toMatch(/a title the bank does not document is not/);
    expect(system.content).toMatch(/Say in NOTES which title you chose/);
  });

  it("never lets a plain title win over a senior or levelled one for the same job", () => {
    const [system] = buildResumeMessages(posting, []);
    expect(system.content).toMatch(/the plain one is never the pick/);
  });

  it("carries the standards and the exact heading shape the PDF renders", () => {
    const [system] = buildResumeMessages(posting, []);
    expect(system.content).toMatch(/One page/);
    expect(system.content).toMatch(/XYZ pattern/);
    expect(system.content).toMatch(/"### Company \| Title \| Mon YYYY – Mon YYYY"/);
    expect(system.content).toMatch(/Summary: omit it, unless/);
  });
});

describe("buildReviewMessages", () => {
  it("hands the reviewer the listing, the bank, the draft and the truth check", () => {
    const [system, user] = buildReviewMessages(posting, [{ path: "resume/notes.md", text: "Built X." }], {
      resume: "# Jakob Rossi\n## Experience\n- Built X.",
      notes: "Chose title A.",
    });
    expect(system.content).toMatch(/TRUTH CHECK/);
    expect(system.content).toMatch(/Never the plain title when a senior or levelled one is documented/);
    expect(user.content).toContain("Company: Stripe");
    expect(user.content).toContain("--- resume/notes.md ---");
    expect(user.content).toContain("DRAFT RESUME\n# Jakob Rossi");
    expect(user.content).toContain("DRAFT NOTES\nChose title A.");
  });

  it("says so when the listing could not be read", () => {
    const [, user] = buildResumeMessages({ ...posting, postingText: "" }, []);
    expect(user.content).toMatch(/could not be read/);
  });

  it("caps the bank", () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ path: `n${i}.md`, text: "x".repeat(MAX_BANK_CHARS / 4) }));
    const [, user] = buildResumeMessages(posting, big);
    expect(user.content.length).toBeLessThan(MAX_BANK_CHARS + 2_000);
  });
});

describe("splitResumeOutput", () => {
  it("separates resume and notes", () => {
    const out = splitResumeOutput("=== RESUME ===\n# Jake\n=== NOTES ===\n- emphasised Go");
    expect(out).toEqual({ resume: "# Jake", notes: "- emphasised Go" });
  });

  it("unwraps a fenced resume and tolerates missing markers", () => {
    expect(splitResumeOutput("=== RESUME ===\n```markdown\n# Jake\n```\n=== NOTES ===\nn").resume).toBe("# Jake");
    expect(splitResumeOutput("# Jake only")).toEqual({ resume: "# Jake only", notes: "" });
  });
});

describe("resumeFileName", () => {
  it("is filesystem-safe", () => {
    expect(resumeFileName("A/B: Co", "Eng | II")).toBe("Resume - A B Co - Eng II.md");
  });
});
