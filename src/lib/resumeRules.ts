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

import { ROLE_TYPE_GUIDANCE, rulesBlock, type ResumeRule, type RoleType } from "./resumeFormatRules";

export type NoteSource = { path: string; text: string };

export type PostingInput = {
  company: string;
  title: string;
  location: string;
  url: string;
  /** The listing page as text; empty when it could not be fetched. */
  postingText: string;
  /** Where the candidate lives, from the saved profile: context, never written by the model. */
  candidateLocation?: string;
};

/** The candidate-location line for both prompts, or nothing when unknown. */
function candidateBlock(posting: PostingInput): string[] {
  return posting.candidateLocation
    ? ["", `CANDIDATE: lives in ${posting.candidateLocation} (from their saved profile; context only, the header is added from it).`]
    : [];
}

/** Longest posting text sent, in characters: the useful part is the first few thousand. */
export const MAX_POSTING_CHARS = 12_000;
/** Longest experience bank sent, in characters. */
export const MAX_BANK_CHARS = 120_000;

export const RESUME_SYSTEM_PROMPT = `You tailor a software engineer's resume to one specific job listing. The candidate is competing for interviews against hundreds of applicants; a recruiter skims each resume for a few seconds, then a hiring manager reads the survivors closely. Take all the effort the task deserves.

SOURCE OF TRUTH
- The EXPERIENCE BANK below is the only source of facts about the candidate: employers, titles, dates, projects, technologies, results.
- Never invent or embellish an employer, title, date, degree, technology, team size, or metric. Never inflate a number or round it upward. If a result has no number in the bank, describe it without one.
- Each source starts with its vault path. Folders group sources by employer or period (for example a folder named after the current employer, and one for everything before it). Older saved resume versions may carry outdated titles or wording: when sources conflict, trust hand-written notes first, then the newest version.
- You may select, reorder, merge, trim and reword; mirror the listing's own vocabulary where the candidate genuinely has that experience; and choose the strongest truthful framing.

TITLES
- One job may appear in the bank under more than one real title: the employer's official title (for example a levelled one like "Engineer 3") and the market-equivalent title used on earlier resumes (for example "Senior Software Engineer"). Every title the bank documents for that job is fair to use; a title the bank does not document is not, and two titles are never merged into a new one.
- Pick, per listing, the documented title its reader will understand correctly: the one closest to the listing's own title and vocabulary (a "Full Stack" listing gets the full-stack title; a "Senior Software Engineer" listing gets that one); when the listing fits neither, the one that best conveys the candidate's level to that company. Use exactly one title per job.
- Never pick a title that understates the others documented for the same job: when a plain title sits alongside a senior or levelled one, the plain one is never the pick.
- Say in NOTES which title you chose and why, and name the alternatives, so the candidate can override it.

RESEARCH
- Use web search to learn what this company and team build, their stack, their interview and hiring culture, and what they value, so the resume speaks to it. Do not name-drop the research in the resume itself.

STANDARDS (what recruiters, hiring managers and engineering-resume communities agree on)
- One page, always. Budget about 550-650 words for the whole resume. When it doesn't fit, cut the oldest and least relevant bullets first, never the recent impact.
- Experience first, jobs in reverse chronological order. BULLET BUDGET (the candidate's approved rule, 2026-10-24): 14-16 bullets in total, weighted to recent work -- current role 5-6, previous role 4-5, internship 1 or none. Projects get one line each, and are dropped for leadership-track roles unless directly relevant.
- Within a job, order bullets by relevance to this listing, not chronology. For senior and leadership targets, the current role's first bullet makes scope visible (systems owned, users served, teams worked across).
- Every bullet is 15-25 words, with the result in the first few words. A second sentence only when it lands a key result or carries a metric.
- Every bullet follows the XYZ pattern: accomplished [X], measured by [Y], by doing [Z]. Open with a strong, varied verb; name the scope (what system, how many users or services, who depended on it) and the outcome, not the task. Use a number only when the bank gives one. Each bullet shows a different kind of impact: shipped, owned a rollout, found a root cause, designed, reviewed, mentored.
- Past tense for past roles; the current role may use past tense too, consistently. No pronouns, no "responsible for", no "helped", no "various", no soft-skill claims without evidence.
- Lead with seniority signals for a senior or levelled role: ownership of a system, staged production rollouts, design documents, cross-team work, code review, on-call, mentoring.
- Mirror the listing's most-repeated skill terms in its exact wording, only where the bank supports them, and in a bullet that proves them, not just in Skills.
- Skills: 8-12 items in total, grouped by category (Languages; Frameworks; Cloud & Infrastructure; Data; Observability; AI/ML), ordered by this listing's priorities, the first item being what the candidate would be interviewed in. Drop skills unrelated to this listing. Only skills the candidate could discuss for several minutes; nothing from the listing that the bank does not support. No proficiency ratings.
- Summary (auto): include one only when the ROLE TYPE is leadership (tech lead, EM, director) or the listing is a clear domain change from the work history: two lines, containing exactly one concrete figure from the bank. No summary for straight SWE roles. Never a generic objective.
- Projects only when they add evidence the experience lacks for this listing (a language or domain the listing needs), one line each; none for leadership-track roles unless directly relevant. Education last; certifications only if relevant to the listing.

DETAIL AND SPECIFICITY
- Every specific detail in a bullet must pass at least one test, or it is cut: (1) POSTING MATCH -- the listing names it; (2) SIZES THE IMPACT -- users, money, %, latency, volume, team size; (3) SHOWS OWNERSHIP OR SENIORITY -- led, owned, designed, authored the design doc; (4) RECOGNIZABLE OUTSIDE THE COMPANY -- public technologies and standards.
- Always cut: internal names, codenames, team or template jargon, ticket or epic counts; process step lists (keep the outcome and at most one artifact, e.g. "from design doc to production alerting"); debugging mechanics (say what broke, who it affected, that you fixed it -- a mechanism of 6 words or fewer may stay only for a systems role); detail no hiring manager could act on.
- At most 3 technologies in one bullet and at most one tech list per bullet; never repeat the same stack across bullets. Skills carries the rest.
- Calibrate depth to the ROLE TYPE given with the listing.

VOICE
- Match the register of the VOICE EXEMPLARS (the candidate's own hand-written bullets): plain, confident, outcome-first, no internal process. They show voice only: never copy their content, numbers or claims; every fact comes from the EXPERIENCE BANK.

RULES
- The RESUME RULES are the candidate's own corrections and are HARD CONSTRAINTS: they override the style guide and every standard above. Check every bullet against every rule.
- Standard section names, no photo, no icons, no tables or columns, no colour, no graphics.
- Do NOT write the name or contact line: the header (name, email, phone, location, links) is added from the candidate's saved profile. Never put the candidate's home city or contact details anywhere else either; older resumes in the bank carry outdated ones.
- Spell every product, language and framework the way its maker does (TypeScript, PostgreSQL, Node.js, React, AWS Lambda).

FORMAT (the exact Markdown shape the PDF renderer expects; anything else renders badly)
- No "# Name" heading and no contact line; begin with the first "##" section.
- Sections as "## Experience", "## Projects", "## Skills", "## Education" (and "## Summary" only when the rule above allows one).
- Each job as a heading "### Company | Title | Mon YYYY – Mon YYYY" (three parts separated by " | "; "Present" for a current role), then its bullets as "- " lines. Location may follow the company after a comma.
- Each project as "### Name | technologies | Year", then one bullet.
- Each education entry as "### School | Degree, Minor | Mon YYYY", then an optional bullet (honours, relevant coursework, certifications).
- Skills as "- **Category:** item, item, item" lines. Bold only category labels, nothing else.

OUTPUT
Exactly two parts, in this order, separated by the marker lines shown:
=== RESUME ===
(the resume, Markdown)
=== NOTES ===
(for the candidate only: what you emphasised and why -- why these bullets and this order were chosen for this listing; the title chosen and its alternatives; whether a summary was included and why; a "Rules applied" list naming each rule id that shaped a bullet and how; which requirements the bank does NOT cover, so they can be addressed honestly; 3-5 bullet facts about the company from your research, each with its source URL)`;

/**
 * The second pass. A fresh reading of the draft against the listing, the bank
 * and the standards, by the three readers it has to survive, before it goes
 * out. The reviewer may only remove, tighten or reorder; adding a claim the
 * bank does not support is the one thing it may never do.
 */
export const REVIEW_SYSTEM_PROMPT = `You are the final reviewer of a tailored software-engineer resume before it is sent. Read it three ways, in order, and fix what each reader would object to:

1. THE PARSER. The applicant tracking system reads top to bottom. Standard section names, no tables, no columns, the exact Markdown shape below. Every required skill in the listing that the bank genuinely supports appears in the resume in the listing's own words (in a bullet that proves it, and in Skills).
2. THE RECRUITER. Seven seconds. Name, current title, current employer and the three strongest bullets must land in the top third. Title must match the listing's level. One page, always: 550-650 words in total, nothing wrapping to a third line at 10pt on a letter page. When it doesn't fit, cut the oldest and least relevant bullets first, never the recent impact.
3. THE HIRING MANAGER. Reads every bullet. Each one must state scope, action and outcome (XYZ), start with a varied strong verb, avoid "responsible for" and "helped", and carry a number only where the EXPERIENCE BANK has one. Bullets that restate each other merge. Claims the manager would probe in an interview and the candidate could not defend for five minutes come out.

4. THE SPECIFICITY RUBRIC. For every specific detail in every bullet, apply the four tests: POSTING MATCH (the listing names it), SIZES THE IMPACT (users, money, %, latency, volume, team size), SHOWS OWNERSHIP OR SENIORITY (led, owned, designed, wrote the design doc), RECOGNIZABLE OUTSIDE THE COMPANY (public technologies and standards). A detail passing none is cut. Always cut internal names, codenames, jargon and ticket/epic counts; process step lists (keep the outcome and at most one artifact); debugging mechanics (at most ~6 words of mechanism, and only for a systems ROLE TYPE); more than 3 technologies in a bullet; a stack already named in another bullet. Depth follows the ROLE TYPE: systems roles may keep protocol- and language-level depth; leadership roles name artifacts and scope, never mechanics.

BUDGET (the candidate's approved rule, 2026-10-24): 14-16 bullets in total, weighted to recent work -- current role 5-6, previous role 4-5, internship 1 or none; projects one line each, dropped for leadership-track roles unless relevant. 15-25 words per bullet, the result in the first few words; a second sentence only to land a key result or metric. Bullets within a role ordered by relevance to the listing. Skills 8-12 items in the listing's priority order. Summary only for a leadership ROLE TYPE or a domain change: two lines with one concrete figure; none for straight SWE roles. When a FORMAT CHECK block is given, its counts are exact (computed in code): fix every MUST item, exactly as named.

RULES CHECK: the RESUME RULES are the candidate's own corrections and HARD CONSTRAINTS. Check every bullet against every rule and fix every violation; they override the style guide and the standards.

VOICE: keep the register of the VOICE EXEMPLARS (plain, confident, outcome-first); never take content from them.

TRUTH CHECK, before anything else: compare every employer, title, date, technology, number and claim in the draft against the EXPERIENCE BANK. Anything the bank does not support is removed or reworded until it is. Numbers are never rounded upward. Titles follow the TITLES rules below exactly.

TITLES
- Every title the bank documents for a job is fair; one the bank does not document is not; two are never merged into a new one.
- One title per job, the one closest to the listing's title and vocabulary; otherwise the one that best conveys the candidate's level. Never the plain title when a senior or levelled one is documented for the same job.

FORMAT (the exact Markdown shape the PDF renderer expects)
- No "# Name" heading and no contact line: the header comes from the candidate's saved profile and is added afterwards. Begin with the first "##" section; never change or add a name, address, city, email, phone or link.
- "## Experience", "## Projects", "## Skills", "## Education" ("## Summary" only for a leadership ROLE TYPE or a pivot: two lines, one concrete figure).
- Jobs as "### Company | Title | Mon YYYY – Mon YYYY" then "- " bullets; projects as "### Name | technologies | Year"; education as "### School | Degree | Mon YYYY".
- Skills as "- **Category:** item, item" lines. Bold only category labels.

OUTPUT
Exactly two parts, separated by the marker lines shown:
=== RESUME ===
(the revised resume, complete, Markdown)
=== NOTES ===
(the draft's notes, kept -- including why these bullets were chosen -- followed by a "**Review**" heading listing what you changed and why, and any claim you removed as unsupported; a "**Rules applied**" heading listing each rule id that changed or constrained a bullet and how; and a "**Detail cuts**" heading listing each specific detail you trimmed, quoted briefly, with the test it failed or the cut rule it hit -- "(none)" when nothing was cut)`;

/**
 * The vault guidance both passes carry (2026-10-24): the rules note as hard
 * constraints, the style guide, the voice exemplars and the role type.
 */
export type TailoringGuidance = {
  rules: ResumeRule[];
  styleGuide: string;
  exemplars: string[];
  roleType: RoleType;
};

/** Longest style guide sent; it is a page or two of Markdown. */
export const MAX_STYLE_GUIDE_CHARS = 16_000;

function guidanceBlocks(g: TailoringGuidance | undefined): string[] {
  if (!g) return [];
  const out: string[] = ["", `ROLE TYPE: ${ROLE_TYPE_GUIDANCE[g.roleType]}`];
  const rules = rulesBlock(g.rules);
  if (rules) out.push("", rules);
  if (g.exemplars.length > 0) {
    out.push("", "VOICE EXEMPLARS (the candidate's own hand-written bullets: match the register only, never copy content):", ...g.exemplars.map((e) => `- ${e}`));
  }
  if (g.styleGuide.trim()) {
    out.push("", "STYLE GUIDE (the candidate's researched guidance; the RESUME RULES override it):", g.styleGuide.trim().slice(0, MAX_STYLE_GUIDE_CHARS));
  }
  return out;
}

export function buildResumeMessages(
  posting: PostingInput,
  bank: NoteSource[],
  guidance?: TailoringGuidance
): { role: "system" | "user"; content: string }[] {
  const postingText = posting.postingText.trim().slice(0, MAX_POSTING_CHARS);
  const user = [
    `JOB LISTING`,
    `Company: ${posting.company}`,
    `Title: ${posting.title}`,
    `Location: ${posting.location}`,
    `URL: ${posting.url}`,
    ...candidateBlock(posting),
    ...guidanceBlocks(guidance),
    "",
    postingText
      ? `Listing text:\n${postingText}`
      : // 2026-10-24: said plainly so the model searches for this exact
        // posting and flags it, rather than writing to a guessed role.
        "LISTING TEXT MISSING: the listing page could not be read (it needs a browser or a sign-in). Find this exact posting by web search from the title, company and URL, research the role and company, and say in the notes that the listing itself was not read.",
    "",
    "EXPERIENCE BANK",
    bankBlock(bank),
  ].join("\n");
  return [
    { role: "system", content: RESUME_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** The bank as one block, newest and hand-written sources first, within the cap. */
function bankBlock(bank: NoteSource[]): string {
  let bankText = "";
  for (const note of bank) {
    const block = `--- ${note.path} ---\n${note.text.trim()}\n\n`;
    if (bankText.length + block.length > MAX_BANK_CHARS) break;
    bankText += block;
  }
  return bankText.trim();
}

export function buildReviewMessages(
  posting: PostingInput,
  bank: NoteSource[],
  draft: { resume: string; notes: string },
  guidance?: TailoringGuidance,
  /** formatIssuesBlock() of the draft: the exact bullets over a limit. */
  formatCheck = ""
): { role: "system" | "user"; content: string }[] {
  const postingText = posting.postingText.trim().slice(0, MAX_POSTING_CHARS);
  const user = [
    `JOB LISTING`,
    `Company: ${posting.company}`,
    `Title: ${posting.title}`,
    `Location: ${posting.location}`,
    `URL: ${posting.url}`,
    ...candidateBlock(posting),
    ...guidanceBlocks(guidance),
    "",
    postingText ? `Listing text:\n${postingText}` : "The listing page could not be read; judge from the title, company and URL.",
    "",
    "EXPERIENCE BANK",
    bankBlock(bank),
    "",
    "DRAFT RESUME",
    draft.resume.trim(),
    "",
    "DRAFT NOTES",
    draft.notes.trim() || "(none)",
    ...(formatCheck ? ["", formatCheck] : []),
  ].join("\n");
  return [
    { role: "system", content: REVIEW_SYSTEM_PROMPT },
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

// ---------------------------------------------------------------- header

/** The profile fields the resume header is built from (applyAnswerRules.ApplicantProfile). */
export type HeaderProfile = {
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  linkedin: string;
  github: string;
  website: string;
};

/** "https://www.linkedin.com/in/x/" -> "linkedin.com/in/x". */
export function bareDomain(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/**
 * The resume's name and contact line, from the saved applicant profile only.
 *
 * 2026-10-24: the model used to write the header and took the city from old
 * resumes in the vault ("McLean, VA" from the Capital One years, "Victor, NY"
 * from an older one) while Jake lives in Vienna, VA. The profile is the source
 * of truth; a field it lacks is left out rather than guessed.
 */
export function profileHeader(p: HeaderProfile): string {
  const first = (p.preferredName || p.firstName).trim();
  const name = [first, p.lastName.trim()].filter(Boolean).join(" ");
  const location = [p.city.trim(), p.state.trim()].filter(Boolean).join(", ");
  const contact = [p.email.trim(), p.phone.trim(), location, ...[p.website, p.linkedin, p.github].map(bareDomain)].filter(Boolean);
  return [name ? `# ${name}` : "", contact.join(" | ")].filter(Boolean).join("\n");
}

/**
 * The resume with the model's header (anything before the first "##"
 * section) replaced by the profile's. Deterministic whatever either pass wrote.
 */
export function withProfileHeader(resume: string, p: HeaderProfile): string {
  const i = resume.search(/^##\s/m);
  const body = (i === -1 ? resume.replace(/^#\s.*\n?/, "") : resume.slice(i)).trim();
  const header = profileHeader(p);
  return header ? `${header}\n\n${body}` : body;
}

/** Location for the prompt: context for the model, never something it writes. */
export function profileLocation(p: Pick<HeaderProfile, "city" | "state">): string {
  return [p.city.trim(), p.state.trim()].filter(Boolean).join(", ");
}
