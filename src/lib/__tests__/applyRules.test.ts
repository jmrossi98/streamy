import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { applyTargetFromPostingId, applyTargetFromUrl, applyUrl, ashbyFields, greenhouseFields } from "../applyFormRules";
import { applyModelAnswers, normalizeProfile, parseAnswerJson, planAnswers, unansweredRequired } from "../applyAnswerRules";
import { buildUserscript } from "../applyUserscript";
import { resumeToPdf, toWinAnsi } from "../resumePdf";

const gh = greenhouseFields({
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Email", required: true, fields: [{ name: "email", type: "input_text" }] },
    { label: "Resume/CV", required: false, fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
    { label: "Cover Letter", required: false, fields: [{ name: "cover_letter", type: "input_file" }] },
    {
      label: "Will you require Visa Sponsorship now, or in the future?",
      required: true,
      fields: [{ name: "question_1", type: "multi_value_single_select", values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }],
    },
    {
      label: "Where did you first hear about this role?",
      required: true,
      fields: [{ name: "question_2", type: "multi_value_single_select", values: [{ label: "LinkedIn", value: 5 }, { label: "Company Website", value: 6 }] }],
    },
    { label: "Why Vercel?", required: true, fields: [{ name: "question_3", type: "textarea" }] },
    {
      label: "By submitting my application, I acknowledge the privacy notice",
      required: true,
      fields: [{ name: "question_4", type: "multi_value_single_select", values: [{ label: "I acknowledge", value: 1 }] }],
    },
  ],
  demographic_questions: {
    questions: [{ id: 99, label: "Gender", required: false, answer_options: [{ id: 1, label: "Man" }, { id: 3, label: "I don't wish to answer" }] }],
  },
});

const profile = normalizeProfile({ firstName: "Jane", lastName: "Doe", email: "j@example.com", needsSponsorship: "no" });

describe("targets", () => {
  it("round-trips posting ids and page URLs", () => {
    const t = applyTargetFromPostingId("greenhouse:vercel:6136160004")!;
    expect(applyTargetFromUrl(applyUrl(t))).toEqual(t);
    expect(applyTargetFromUrl("https://job-boards.greenhouse.io/vercel/jobs/6136160004?gh_src=x")).toEqual(t);
    const a = applyTargetFromPostingId("ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245")!;
    expect(applyTargetFromUrl(applyUrl(a))).toEqual(a);
    expect(applyTargetFromPostingId("workday:nvidia:1")).toBeNull();
  });
});

describe("greenhouseFields", () => {
  it("keeps the file variant of resume and reads demographics", () => {
    expect(gh.find((f) => f.key === "resume")).toMatchObject({ kind: "file", fileRole: "resume" });
    expect(gh.find((f) => f.key === "resume_text")).toBeUndefined();
    expect(gh.find((f) => f.key === "99")).toMatchObject({ demographic: true, kind: "select" });
  });
});

describe("ashbyFields", () => {
  it("maps Ashby's types", () => {
    const f = ashbyFields({
      applicationForm: {
        sections: [
          {
            fieldEntries: [
              { isRequired: true, field: { path: "_systemfield_name", title: "Legal Name", type: "String" } },
              { isRequired: true, field: { path: "b1", title: "Do you have 5+ years of Go?", type: "Boolean" } },
            ],
          },
        ],
      },
    });
    expect(f.map((x) => x.kind)).toEqual(["text", "boolean"]);
  });
});

describe("planAnswers", () => {
  const { answers, forModel } = planAnswers(gh, profile);
  const by = (k: string) => answers.find((a) => a.key === k)!;

  it("answers identity, sponsorship and source from the profile", () => {
    expect(by("first_name").value).toBe("Jane");
    expect(by("question_1")).toMatchObject({ value: "0", display: "No", source: "profile" });
    expect(by("question_2")).toMatchObject({ display: "Company Website" });
    expect(by("resume").source).toBe("resume");
  });
  it("never answers an acknowledgement", () => {
    expect(by("question_4").source).toBe("you");
  });
  it("declines demographics", () => {
    expect(by("99")).toMatchObject({ value: "3", source: "profile" });
  });
  it("sends only open questions to the model, and validates what comes back", () => {
    expect(forModel.map((f) => f.key)).toEqual(["question_3"]);
    const out = applyModelAnswers(answers, parseAnswerJson('```json\n{"question_3": "Because."}\n```'));
    expect(out.find((a) => a.key === "question_3")).toMatchObject({ value: "Because.", source: "ai" });
    expect(unansweredRequired(out).map((a) => a.key)).toEqual(["question_4"]);
  });
  it("rejects a select answer that is not an option", () => {
    const sel = [{ key: "s", label: "Pick", kind: "select" as const, required: true, value: null, source: "none" as const, options: [{ label: "A", value: "1" }] }];
    expect(applyModelAnswers(sel, { s: "Z" })[0].source).toBe("you");
    expect(applyModelAnswers(sel, { s: "a" })[0]).toMatchObject({ value: "1", source: "ai" });
  });
});

describe("resumeToPdf", () => {
  it("renders the resume Markdown subset, unicode included", async () => {
    const pdf = await resumeToPdf("# Jane Doe\njane@example.com · github.com/jane\n## Experience\n### Acme — Engineer\n- Built **fast** things → 2x ≥ before\n\nText.", "t");
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    expect(toWinAnsi("a → b ✓")).toBe("a -> b ");
  });
});

describe("buildUserscript", () => {
  it("is valid JavaScript with the header and config", () => {
    const js = buildUserscript("https://streamy.example.com/", "tok");
    expect(js).toContain("// @connect      streamy.example.com");
    expect(() => new Script(js)).not.toThrow();
  });
});
