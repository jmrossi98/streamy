/**
 * Whether a director or VP posting is one Jake could plausibly get. Pure; the
 * listing reads and the database writes live in jobPostings.ts.
 *
 * 2026-10-24: director and VP titles used to be vetoed outright. Jake asked to
 * see the ones he could qualify for: the listing's minimum years of
 * experience (and of managing managers, when it says) no more than a year
 * above his own. His experience is computed from the resume knowledge base,
 * not written down here, so it keeps counting up as the years pass. A posting
 * whose requirement can't be read is hidden: a director role that states no
 * bar at all is rare, and guessing in its favour would fill the list with
 * roles that want fifteen years.
 */

/** What a listing asks for, as stored on the posting. */
export type ExecRequirement = {
  /** Minimum years of experience overall; null when the listing states none. */
  years: number | null;
  /** Minimum years managing managers, when the listing says. */
  managerYears: number | null;
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  twenty: 20,
};

/**
 * "10+ years", "8 or more years", "5-7 years", "ten (10) years", "a minimum
 * of 12 years". The first number of a range is the minimum.
 */
const YEARS_RE = new RegExp(
  String.raw`\b(\d{1,2}|${Object.keys(WORD_NUMBERS).join("|")})(?:\s*\(\d{1,2}\))?\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*)?(?:\+|or more|or greater)?\s*(?:\+\s*)?years?\b`,
  "gi"
);

/** Managing managers, said several ways. */
const MANAGER_OF_MANAGERS =
  /\b((?:manag|lead)\w*\s+(?:[\w-]+\s+){0,3}managers|managers of managers|manager of managers|leaders of leaders|leading leaders|other leaders|multi-level|multiple levels of management|managing multiple teams through managers)\b/i;

/** People management: not overall experience, but a floor under it when that is all a listing says. */
const PEOPLE_MANAGEMENT =
  /\b(people manag|managing (?:engineering )?teams|managing engineers|managing software|engineering management|management experience|leading (?:and scaling )?(?:engineering )?(?:teams|organizations|orgs)|scaling engineering|leadership experience|direct reports)/i;

/** Overall experience: the words that follow a real requirement. */
const EXPERIENCE = /\b(experience|industry|professional|software|engineering|technical|development|building|working)\b/i;

/** "the company has been around 40 years", "over the next 3 years": not a requirement. */
const NOT_A_REQUIREMENT = /\b(old|ago|history|founded|anniversary|next|past|last|vesting|tenure|in business)\b/i;

/**
 * The minimum years a listing asks for.
 *
 * Each "N years" mention is read with the words around it. Mentions about
 * managing managers go to managerYears; the rest are overall experience,
 * and the smallest one wins: "BS + 12 years or MS + 10 years" means 10, and
 * a preferred "15+ years" beside a required "10+" does not raise the bar.
 * People-management years count only when nothing else is stated.
 */
export function extractExecRequirement(text: string): ExecRequirement {
  const general: number[] = [];
  const people: number[] = [];
  const managers: number[] = [];
  const matches = [...text.matchAll(YEARS_RE)];
  matches.forEach((m, i) => {
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
    if (!n || n > 30) return;
    const at = m.index ?? 0;
    const end = at + m[0].length;
    // The words that belong to this number: up to the next "N years" or the
    // end of the sentence. "10+ years of software engineering experience,
    // including 5+ years managing managers" is 10 overall and 5 managing
    // managers (Chime, 2026-10-24) -- not 10 managing managers.
    const next = matches[i + 1]?.index ?? text.length;
    const prevEnd = i > 0 ? (matches[i - 1].index ?? 0) + matches[i - 1][0].length : 0;
    const clause = text.slice(end, Math.min(next, end + 160)).split(/[.;\n•]/)[0];
    const before = text.slice(Math.max(prevEnd, at - 60), at);
    const near = `${before.split(/[.;\n•]/).pop() ?? ""} ${clause}`;
    if (NOT_A_REQUIREMENT.test(clause.slice(0, 25))) return;
    if (MANAGER_OF_MANAGERS.test(near)) managers.push(n);
    else if (PEOPLE_MANAGEMENT.test(clause)) people.push(n);
    else if (EXPERIENCE.test(clause) || /\b(minimum|at least)\b/i.test(before.slice(-25))) general.push(n);
  });
  const min = (xs: number[]) => (xs.length > 0 ? Math.min(...xs) : null);
  return { years: min(general) ?? min(people), managerYears: min(managers) };
}

// -------------------------------------------------------------- experience

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?`;
/** "Aug 2019 – Present", "August 2019 - Mar 2024", "08/2019 – 03/2024". */
const RANGE_RE = new RegExp(
  String.raw`(?:${MONTH}\s+(\d{4})|(\d{1,2})\/(\d{4}))\s*(?:-|–|—|to)\s*(?:${MONTH}\s+\d{4}|\d{1,2}\/\d{4}|present|current|now|today)`,
  "gi"
);

const INTERN = /\b(intern|internship|co-op)\b/i;
const EDUCATION = /\b(universit|college|school|institute of|bachelor|master'?s|degree|gpa|coursework)|\b(b\.?s|b\.?a|m\.?s)\b/i;
const ROLE = /\b(engineer|developer|software|swe|sde|programmer|scientist|architect|technical|lead)/i;

export type CareerExperience = {
  /** First full-time role (not an internship). */
  careerStart: Date | null;
  internshipStart: Date | null;
  /** Years since careerStart, fractional; null when no role date was found. */
  years: number | null;
};

type Kind = "intern" | "education" | "role";

/** Internship and education outrank role words: "Software Engineering Intern" is an internship. */
function kindOf(text: string): Kind | null {
  if (INTERN.test(text)) return "intern";
  if (EDUCATION.test(text)) return "education";
  if (ROLE.test(text)) return "role";
  return null;
}

/** A heading-like neighbour: not a bullet and not a sentence of prose. */
function isHeadingLine(line: string | undefined): line is string {
  return !!line && line.trim().length > 0 && line.trim().length <= 100 && !/^\s*[-•*▪●◦]/.test(line);
}

/**
 * Career length from the resume knowledge base: the earliest dated role that
 * is neither an internship nor education, to now.
 *
 * A date range is classified by the words just around it on its own line
 * first ("Capital One | Software Engineer | Aug 2019 – Present"), then by the
 * nearest heading-like line -- Word exports put "Software Engineer" on one
 * line and "Aug 2019 – Present" on the next. Bullets are never used:
 * "mentored two interns" says nothing about the job above it. A range
 * nothing identifies is ignored rather than guessed at.
 */
export function careerExperience(texts: string[], now: Date): CareerExperience {
  const roles: number[] = [];
  const interns: number[] = [];
  for (const text of texts) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(RANGE_RE)) {
        const start = m[1]
          ? Date.UTC(Number(m[2]), MONTHS[m[1].toLowerCase()])
          : Date.UTC(Number(m[4]), Number(m[3]) - 1);
        if (!Number.isFinite(start) || start > now.getTime()) continue;
        // A PDF can arrive as one long line, so only the words near the range.
        const at = m.index ?? 0;
        const own = line.slice(Math.max(0, at - 60), at + m[0].length + 40);
        // A neighbour with its own dates is a different entry: in Jake's
        // resumes "Mastodon Design LLC   Sept 2018 – Present" (the whole
        // tenure, internship included) sits above "Software Engineer II |
        // Aug 2019 – Present", and must not borrow that line's role.
        const neighbours = [lines[i - 1], lines[i + 1], lines[i - 2]]
          .filter(isHeadingLine)
          .filter((l) => !new RegExp(RANGE_RE.source, "i").test(l));
        const kind = kindOf(own) ?? neighbours.map(kindOf).find((k) => k !== null) ?? null;
        if (kind === "intern") interns.push(start);
        else if (kind === "role") roles.push(start);
      }
    });
  }
  // A "role" that starts the month an internship does is that internship
  // under another title: an old resume lists the Sept 2018 internship as
  // "Applications Developer, Sept 2018 – Present" (2026-10-24).
  const internMonths = new Set(interns);
  const fullTime = roles.filter((t) => !internMonths.has(t));
  const career = fullTime.length > 0 ? Math.min(...fullTime) : null;
  const intern = interns.length > 0 ? Math.min(...interns) : null;
  const years = career === null ? null : (now.getTime() - career) / (365.25 * 86_400_000);
  return {
    careerStart: career === null ? null : new Date(career),
    internshipStart: intern === null ? null : new Date(intern),
    years: years === null ? null : Math.round(years * 10) / 10,
  };
}

// -------------------------------------------------------------- the decision

/**
 * Years Jake has managed managers. Zero: the knowledge base has no
 * people-management role (2026-10-24), and a date range can't say which
 * years were spent managing whom.
 */
export const MANAGER_OF_MANAGERS_YEARS = 0;

/** How far above his experience a requirement may sit and still be shown. */
export const STRETCH_YEARS = 1;

export type ExecCheck = {
  checkedAt: Date | null;
  /** "read": text was read; "unread": the listing could not be fetched or rendered. */
  status: "read" | "unread" | null;
} & ExecRequirement;

/** Why a director/VP posting is hidden, or null when it is shown. */
export function execHiddenReason(check: ExecCheck, experienceYears: number | null): string | null {
  if (!check.checkedAt) return "Checking the listing's requirements";
  if (check.status !== "read") return "Couldn't read the listing";
  if (check.years === null) return "The listing states no minimum experience";
  if (experienceYears === null) return "Your experience couldn't be read from the resume knowledge base";
  if (check.years > experienceYears + STRETCH_YEARS) {
    return `Asks for ${check.years}+ years; you have ${experienceYears.toFixed(1)}`;
  }
  if (check.managerYears !== null && check.managerYears > MANAGER_OF_MANAGERS_YEARS + STRETCH_YEARS) {
    return `Asks for ${check.managerYears}+ years managing managers`;
  }
  return null;
}

// -------------------------------------------------------------- reading the listing

/**
 * The board's own JSON for one posting, when it has one: a cleaner read
 * than the page, and the only one for some. 2026-10-24: Adobe and
 * CrowdStrike's Workday pages are JS-only and not on the renderer's
 * allowlist, and Greenhouse boards on custom career domains (nuro.ai,
 * pinterestcareers.com) serve a JS shell, so their director roles all came
 * back "Couldn't read the listing".
 */
export function listingApiUrl(postingId: string, url: string): string | null {
  const gh = /^greenhouse:([^:]+):(\d+)$/.exec(postingId);
  if (gh) return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(gh[1])}/jobs/${gh[2]}`;
  const wd = /^https:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/(job\/[^?#]+)/.exec(url);
  if (wd) return `https://${wd[1]}.${wd[2]}.myworkdayjobs.com/wday/cxs/${wd[1]}/${wd[3]}/${wd[4]}`;
  return null;
}

/** The description HTML from a listingApiUrl() response, or "" when it has none. */
export function listingApiHtml(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as { content?: unknown; jobPostingInfo?: { jobDescription?: unknown } };
  if (typeof p.content === "string") {
    // Greenhouse escapes its HTML inside the JSON string.
    return p.content.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  const d = p.jobPostingInfo?.jobDescription;
  return typeof d === "string" ? d : "";
}

/** An unread listing is tried again after this long, in case it was a blip. */
export const EXEC_RETRY_MS = 24 * 3600_000;

/** Listing reads per poll: polls run every 30 minutes, so a backlog clears within hours. */
export const EXEC_CHECKS_PER_POLL = 3;

/** Whether a posting's requirement should be (re)read this poll. */
export function needsExecCheck(check: ExecCheck, now: Date): boolean {
  if (!check.checkedAt) return true;
  return check.status === "unread" && now.getTime() - check.checkedAt.getTime() >= EXEC_RETRY_MS;
}
