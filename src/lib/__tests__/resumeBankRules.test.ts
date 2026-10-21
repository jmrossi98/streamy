import { describe, expect, it } from "vitest";
import { assembleBank, fileDate, isBankFile, orderBankFiles, pickBankFiles, type BankFile } from "../resumeBankRules";

const f = (path: string, modified: string | null = null): BankFile => ({
  path,
  kind: path.split(".").pop()!.toLowerCase() as BankFile["kind"],
  modified,
});

describe("isBankFile", () => {
  it("takes notes, Word files and PDFs, nothing else", () => {
    expect(isBankFile("main/resume/a.md")).toBe(true);
    expect(isBankFile("main/resume/a.DOCX")).toBe(true);
    expect(isBankFile("main/resume/a.pdf")).toBe(true);
    expect(isBankFile("main/resume/a.png")).toBe(false);
    expect(isBankFile("main/resume/.obsidian/a.md")).toBe(false);
    expect(isBankFile("main/../secrets.md")).toBe(false);
  });
});

describe("pickBankFiles", () => {
  it("keeps the Word original over its PDF export, per folder", () => {
    const { chosen, superseded } = pickBankFiles([
      { path: "r/old/cv.pdf", modified: null },
      { path: "r/old/cv.docx", modified: null },
      { path: "r/new/cv.pdf", modified: null },
    ]);
    expect(chosen.map((c) => c.path).sort()).toEqual(["r/new/cv.pdf", "r/old/cv.docx"]);
    expect(superseded).toEqual([expect.objectContaining({ path: "r/old/cv.pdf", status: "superseded" })]);
  });
});

describe("fileDate", () => {
  it("reads month_day_year from the name, before the modified time", () => {
    expect(fileDate("r/cv_2_6_2024.docx", "Tue, 21 Oct 2026 00:00:00 GMT")).toBe(Date.UTC(2024, 1, 6));
    expect(fileDate("r/cv_12_02_2025.docx", null)).toBe(Date.UTC(2025, 11, 2));
    expect(fileDate("r/cv.docx", "Tue, 21 Oct 2026 00:00:00 GMT")).toBe(Date.UTC(2026, 9, 21));
    expect(fileDate("r/cv.docx", null)).toBe(0);
  });
});

describe("orderBankFiles", () => {
  it("puts notes first, then the newest versions", () => {
    const order = orderBankFiles([f("r/cv_4_6_2023.docx"), f("r/cv_12_02_2025.docx"), f("r/notes.md"), f("r/cv_2_6_2024.pdf")]);
    expect(order.map((o) => o.path)).toEqual(["r/notes.md", "r/cv_12_02_2025.docx", "r/cv_2_6_2024.pdf", "r/cv_4_6_2023.docx"]);
  });
});

describe("assembleBank", () => {
  const resume = [
    "Jakob Rossi",
    "Built the enrollment flow for the identity web application",
    "Owned the staged production rollout of email verification",
    "Skills",
    "Python",
  ].join("\n");
  const unique = "Led migration of legacy reporting jobs to a streaming pipeline on Kafka and Flink, cutting latency from hours to minutes for downstream finance consumers across four teams";

  it("keeps the first source whole and drops a later copy as a duplicate", () => {
    const { sources, report } = assembleBank(
      [
        { path: "a.md", kind: "md", text: resume },
        { path: "b.docx", kind: "docx", text: resume.toUpperCase() + "\n• " },
      ],
      10_000
    );
    expect(sources.map((s) => s.path)).toEqual(["a.md"]);
    expect(report.map((r) => r.status)).toEqual(["included", "duplicate"]);
  });

  it("keeps only the new lines of an older version", () => {
    const { sources, report } = assembleBank(
      [
        { path: "a.md", kind: "md", text: resume },
        { path: "b.docx", kind: "docx", text: `${resume}\n${unique}` },
      ],
      10_000
    );
    expect(report[1].status).toBe("partial");
    expect(sources[1].text).toContain(unique);
    expect(sources[1].text).not.toContain("enrollment flow");
  });

  it("keeps a source whole when nothing in it was seen before", () => {
    const { report } = assembleBank(
      [
        { path: "a.md", kind: "md", text: resume },
        { path: "b.pdf", kind: "pdf", text: unique },
      ],
      10_000
    );
    expect(report[1].status).toBe("included");
  });

  it("reports unreadable, empty and over-budget files instead of failing", () => {
    const { sources, report } = assembleBank(
      [
        { path: "a.md", kind: "md", text: resume },
        { path: "b.pdf", kind: "pdf", text: null, error: "bad xref" },
        { path: "c.pdf", kind: "pdf", text: "   \n " },
        { path: "d.docx", kind: "docx", text: unique.repeat(3) },
      ],
      400
    );
    expect(sources).toHaveLength(1);
    expect(report.map((r) => r.status)).toEqual(["included", "unreadable", "empty", "over-budget"]);
    expect(report[1].detail).toBe("bad xref");
  });
});
