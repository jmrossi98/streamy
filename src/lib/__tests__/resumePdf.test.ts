import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderResume, resumeToPdf, splitHeading, toWinAnsi } from "../resumePdf";

describe("splitHeading", () => {
  it("separates a role heading into bold company, title, and right-aligned dates", () => {
    expect(splitHeading("Capital One, McLean, VA | Senior Software Engineer | Mar 2025 – Present")).toEqual({
      left: "**Capital One, McLean, VA** Senior Software Engineer",
      right: "Mar 2025 – Present",
    });
    expect(splitHeading("NES Emulator | 2021")).toEqual({ left: "**NES Emulator**", right: "2021" });
  });

  it("leaves a plain heading alone", () => {
    expect(splitHeading("Software Engineer")).toEqual({ left: "Software Engineer", right: null });
  });
});

describe("toWinAnsi", () => {
  it("keeps en dashes and bullets, replaces arrows", () => {
    expect(toWinAnsi("Mar 2025 – Present → now")).toBe("Mar 2025 – Present -> now");
  });
});

function sample(bulletsPerJob: number): string {
  const bullet = "- Led the design and staged rollout of a passwordless verification flow across two backend services, gating each traffic step on funnel metrics.";
  const job = (n: number) =>
    [`### Company ${n}, City, ST | Senior Software Engineer | Jan 2020 – Dec 2024`, ...Array(bulletsPerJob).fill(bullet)].join("\n");
  return [
    "# Jakob Rossi",
    "jmrossi98@gmail.com | 315-759-3519 | Rochester, NY | jakobrossi.com | linkedin.com/in/jakob-rossi",
    "",
    "## Experience",
    job(1),
    "",
    job(2),
    "",
    "## Skills",
    "- **Languages:** Python, TypeScript, C++",
    "- **Cloud & Infrastructure:** AWS Lambda, Docker, Kubernetes",
    "",
    "## Education",
    "### Rochester Institute of Technology | B.S. Software Engineering | May 2021",
  ].join("\n");
}

describe("resumeToPdf", () => {
  it("renders a normal resume on one page", async () => {
    const pdf = await PDFDocument.load(await resumeToPdf(sample(5), "Resume"));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("shrinks a slightly long resume onto one page", async () => {
    // Eleven long bullets per job overflows at full size and fits when squeezed.
    expect((await renderResume(sample(11), "Resume", 1)).getPageCount()).toBe(2);
    const pdf = await PDFDocument.load(await resumeToPdf(sample(11), "Resume"));
    expect(pdf.getPageCount()).toBe(1);
  });

  it("accepts a second page when no squeeze fits", async () => {
    const pdf = await PDFDocument.load(await resumeToPdf(sample(40), "Resume"));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
