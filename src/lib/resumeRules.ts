/**
 * The resume-tailoring prompt, and parsing what comes back. Pure; the calls
 * live in resume.ts.
 *
 * Truthfulness is the one fixed rule. Jake asked for numbers to be "fluffed in
 * my favor within reason" (2026-09-27); invented metrics and inflated claims
 * are exactly what a hiring manager or a reference check exposes, so the model
 * may choose the strongest *truthful* framing and nothing more. Everything
 * else -- selection, order, wording, keywords -- is fair game.
 */

export type NoteSource = { path: string; text: string };

export type PostingInput = {
  company: string;
  title: string;
  location: string;
  url: string;
  /** The listing page as text; empty when it could not be fetched. */
  postingText: string;
};

/** Longest posting text sent, in characters: the useful part is the first few thousand. */
export const MAX_POSTING_CHARS = 12_000;
/** Longest experience bank sent, in characters. */
export const MAX_BANK_CHARS = 60_000;

export const RESUME_SYSTEM_PROMPT = `You tailor a software engineer's resume to one specific job listing.

SOURCE OF TRUTH
- The EXPERIENCE BANK below is the only source of facts about the candidate: employers, titles, dates, projects, technologies, results.
- Never invent or embellish an employer, title, date, degree, technology, team size, or metric. Never inflate a number or round it upward. If a result has no number in the bank, describe it without one.
- You may select, reorder, merge, trim and reword; mirror the listing's own vocabulary where the candidate genuinely has that experience; and choose the strongest truthful framing.

RESEARCH
- Use web search to learn what this company and team build, their stack, and what they value, so the resume speaks to it. Do not name-drop the research in the resume itself.

FORMAT (optimised for applicant-tracking systems and a 30-second human skim)
- One page. Plain Markdown, single column: a "# Name" line, one contact line, then "## Summary" (2-3 lines tailored to this role), "## Experience", "## Projects" if they help, "## Skills", "## Education".
- No tables, columns, images, icons or emoji. Standard section names only.
- Bullets start with a strong past-tense verb, show impact first, and stay under two lines.
- Order experience and bullets by relevance to this listing, not chronology within a job.
- Put the listing's most important required skills in Skills and in the bullets that prove them -- only where the bank supports them.

OUTPUT
Exactly two parts, in this order, separated by the marker lines shown:
=== RESUME ===
(the resume, Markdown)
=== NOTES ===
(for the candidate only: what you emphasised and why; which requirements the bank does NOT cover, so they can be addressed honestly; 3-5 bullet facts about the company from your research, each with its source URL)`;

export function buildResumeMessages(posting: PostingInput, bank: NoteSource[]): { role: "system" | "user"; content: string }[] {
  let bankText = "";
  for (const note of bank) {
    const block = `--- ${note.path} ---\n${note.text.trim()}\n\n`;
    if (bankText.length + block.length > MAX_BANK_CHARS) break;
    bankText += block;
  }
  const postingText = posting.postingText.trim().slice(0, MAX_POSTING_CHARS);
  const user = [
    `JOB LISTING`,
    `Company: ${posting.company}`,
    `Title: ${posting.title}`,
    `Location: ${posting.location}`,
    `URL: ${posting.url}`,
    "",
    postingText
      ? `Listing text:\n${postingText}`
      : "The listing page could not be read. Research the role and company from the title, company and URL.",
    "",
    "EXPERIENCE BANK",
    bankText.trim(),
  ].join("\n");
  return [
    { role: "system", content: RESUME_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** Splits the model's reply into the resume and the notes. */
export function splitResumeOutput(text: string): { resume: string; notes: string } {
  const r = text.indexOf("=== RESUME ===");
  const n = text.indexOf("=== NOTES ===");
  if (r === -1) return { resume: text.trim(), notes: "" };
  const resume = text.slice(r + "=== RESUME ===".length, n > r ? n : undefined).trim();
  const notes = n > r ? text.slice(n + "=== NOTES ===".length).trim() : "";
  // Models sometimes wrap the whole thing in a fence; the viewer wants Markdown.
  return { resume: resume.replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1").trim(), notes };
}

/** A filename for downloads: "Resume - Stripe - Software Engineer.md". */
export function resumeFileName(company: string, title: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `Resume - ${clean(company)} - ${clean(title)}.md`;
}
