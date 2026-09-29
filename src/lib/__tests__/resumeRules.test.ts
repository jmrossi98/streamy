import { describe, expect, it } from "vitest";
import { buildResumeMessages, MAX_BANK_CHARS, resumeFileName, splitResumeOutput } from "../resumeRules";

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
