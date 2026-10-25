/**
 * The resume's shape, checked in code, plus the vault guidance the prompts
 * carry (resume rules, style guide, voice exemplars, role type). Pure; the
 * vault reads live in resume.ts.
 *
 * 2026-10-24: Jake approved exact format rules -- 14-16 bullets weighted to
 * recent work, 15-25 words a bullet, one page, a summary only for leadership
 * or pivot targets -- and asked that detail be calibrated: a generated Meta
 * "Software Engineer, Systems" resume carried "runtime-generation revert",
 * "polled gyroscope GPIO output" and a step-by-step process list. Models
 * count words badly, so the counts are done here and the review is handed
 * the exact bullets to fix rather than asked to notice.
 */

// ------------------------------------------------------------ parsing

export type ResumeEntry = {
  /** The "###" heading, e.g. "Capital One | Senior Software Engineer | Aug 2019 – Present". */
  heading: string;
  bullets: string[];
  internship: boolean;
};

export type ParsedResume = {
  summary: string;
  experience: ResumeEntry[];
  projects: ResumeEntry[];
  /** Skill items across every "- **Category:** a, b" line. */
  skills: string[];
};

/** Splits the Markdown the renderer expects into sections, entries and bullets. */
export function parseResume(markdown: string): ParsedResume {
  const out: ParsedResume = { summary: "", experience: [], projects: [], skills: [] };
  let section = "";
  let entry: ResumeEntry | null = null;
  const summary: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      section = h2[1].trim().toLowerCase();
      entry = null;
      continue;
    }
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      entry = { heading: h3[1].trim(), bullets: [], internship: /\b(intern|internship|co-op)\b/i.test(h3[1]) };
      if (section.startsWith("experience")) out.experience.push(entry);
      else if (section.startsWith("project")) out.projects.push(entry);
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (section.startsWith("skill") && bullet) {
      const items = bullet[1].replace(/^\*\*[^*]+\*\*:?\s*/, "").split(/,\s*/);
      out.skills.push(...items.map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (section.startsWith("summary") && line) {
      summary.push(bullet ? bullet[1] : line);
      continue;
    }
    if (bullet && entry) entry.bullets.push(bullet[1].trim());
  }
  out.summary = summary.join(" ").trim();
  return out;
}

/** Words as a reader counts them: "Node.js", "20%" and "real-time" are one each. */
export function countWords(text: string): number {
  const plain = text.replace(/\*\*|__|`/g, "").trim();
  return plain ? plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** Sentences in a bullet; "e.g." and "Node.js" don't end one. */
export function sentences(text: string): string[] {
  return text
    .replace(/\b(e\.g|i\.e|etc|vs|approx)\./gi, "$1")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------ technologies

/**
 * Public technology names, for "at most 3 per bullet" and "no repeated
 * stacks". The resume's own Skills items are added per check, so a
 * technology this list lacks is still counted once it's listed there.
 */
export const TECH_TERMS = [
  "Python", "Java", "TypeScript", "JavaScript", "Go", "Golang", "Rust", "C++", "C#", "Kotlin", "Swift", "Scala",
  "Ruby", "PHP", "SQL", "Bash", "React", "Angular", "Vue", "Next.js", "Node.js", "Django", "Flask", "FastAPI",
  "Spring", "Spring Boot", ".NET", "AWS", "AWS Lambda", "Lambda", "DynamoDB", "S3", "EC2", "ECS", "EKS", "SQS",
  "SNS", "Kinesis", "Kafka", "RabbitMQ", "Redis", "PostgreSQL", "MySQL", "MongoDB", "Cassandra", "Elasticsearch",
  "Docker", "Kubernetes", "Terraform", "CloudFormation", "Jenkins", "GitHub Actions", "GraphQL", "gRPC",
  "Spark", "Airflow", "Snowflake", "TensorFlow", "PyTorch", "Linux", "GCP", "Azure", "Datadog", "Splunk",
  "Grafana", "Prometheus", "New Relic", "OpenTelemetry", "Jest", "Playwright", "Cypress", "Tailwind", "HTML",
  "CSS", "Unity", "Unreal", "OpenGL", "Vulkan", "CUDA", "SPI", "I2C", "UART", "CAN", "FreeRTOS", "LangChain",
  "LangGraph", "Bedrock", "OpenAI", "Claude",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The distinct technologies a bullet names. Longest names first, so "AWS
 * Lambda" is one technology rather than "AWS" plus "Lambda".
 */
export function technologiesIn(bullet: string, extra: string[] = []): string[] {
  const terms = [...new Set([...TECH_TERMS, ...extra.filter((t) => t.length >= 2 && t.length <= 30)])].sort(
    (a, b) => b.length - a.length
  );
  let hay = ` ${bullet} `;
  const found: string[] = [];
  for (const term of terms) {
    // Case-sensitive for the short all-caps ones ("Go", "CAN", "SQL"), so a
    // plain "go" or "can" in prose isn't a technology.
    const flags = term.length <= 3 || term === "Go" ? "" : "i";
    const re = new RegExp(`(?<![\\w.+#])${escapeRe(term)}(?![\\w+#])`, flags);
    if (re.test(hay)) {
      found.push(term);
      hay = hay.replace(new RegExp(`(?<![\\w.+#])${escapeRe(term)}(?![\\w+#])`, `g${flags}`), " ");
    }
  }
  return found;
}

// ------------------------------------------------------------ role type

/**
 * How much technical depth the posting warrants (the style guide's "How much
 * detail, by role"). Passed to both the draft and the review.
 */
export type RoleType = "systems" | "product" | "senior" | "leadership";

export const ROLE_TYPE_GUIDANCE: Record<RoleType, string> = {
  systems:
    "SYSTEMS / EMBEDDED / INFRA / PERFORMANCE role: technical depth is warranted -- protocols, languages, concurrency, performance numbers; a debugging mechanism of 6 words or fewer may stay. Still no internal names.",
  product:
    "PRODUCT / FULL-STACK role: lead with user and business impact; name the stack once. No protocol- or debugging-level mechanics.",
  senior:
    "SENIOR IC role: architecture choices, ownership, cross-team scope, reliability at scale. Mechanics only where they size the impact. Scope must be visible in the first bullet of the current role.",
  leadership:
    "TECH LEAD / EM / DIRECTOR role: scope (teams, people, systems), decisions, standards set, influence through others. Name leadership artifacts (design docs, reviews led, PRs reviewed across repos), never the mechanics of the work. Scope must be visible in the first bullet of the current role. No Projects section, ever; the current role may carry 7 bullets so the resume still reaches 14.",
};

const LEADERSHIP_TITLE =
  /\b(tech(nical)? lead|technical leadership|team lead(er)?|engineering manager|manager|director|head of|vp|vice president|lead (software )?engineer)\b/i;
const SYSTEMS_TITLE =
  /\b(systems?|embedded|firmware|kernel|infrastructure|infra|platform|distributed|performance|low[- ]latency|sre|site reliability|compiler|networking|network|storage|runtime|engine|graphics|gpu|hpc|database|os)\b/i;
const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|iii|iv|l5|l6|e5|e6)\b/i;

/** The posting's class, from its title: leadership first, then systems, then seniority. */
export function classifyRoleType(title: string): RoleType {
  if (LEADERSHIP_TITLE.test(title) && !/\bproduct manager\b/i.test(title)) return "leadership";
  if (SYSTEMS_TITLE.test(title)) return "systems";
  if (SENIOR_TITLE.test(title)) return "senior";
  return "product";
}

// ------------------------------------------------------------ the checks

/** Jake's approved budget (2026-10-24). */
export const FORMAT_LIMITS = {
  totalBullets: [14, 16],
  currentRole: [5, 6],
  /** Leadership resumes drop projects, so the current role gets a 7th bullet to reach 14. */
  currentRoleLeadership: [5, 7],
  previousRole: [4, 6],
  internshipMax: 1,
  projectBulletsMax: 1,
  bulletWords: [15, 25],
  techPerBullet: 3,
  skills: [8, 12],
  summaryWordsMax: 45,
  /** About one page at 10pt on letter with this layout. */
  totalWordsMax: 680,
} as const;

export type FormatIssue = {
  /** "trim" issues are over a hard limit; "note" ones are judgement calls left to the review. */
  severity: "trim" | "note";
  message: string;
};

function label(entry: ResumeEntry): string {
  return entry.heading.split("|").slice(0, 2).map((s) => s.trim()).join(", ");
}

function preview(bullet: string): string {
  const words = bullet.split(/\s+/);
  return words.length > 9 ? `${words.slice(0, 9).join(" ")}…` : bullet;
}

/** The current role's bullet budget for this kind of posting. */
export function currentRoleLimit(roleType: RoleType): readonly [number, number] {
  return roleType === "leadership" ? FORMAT_LIMITS.currentRoleLeadership : FORMAT_LIMITS.currentRole;
}

/** The most bullets the per-role caps allow; older roles get the previous role's cap. */
export function perRoleCeiling(jobs: number, interns: number, projects: number, roleType: RoleType = "product"): number {
  const L = FORMAT_LIMITS;
  const roles = (jobs > 0 ? currentRoleLimit(roleType)[1] : 0) + Math.max(0, jobs - 1) * L.previousRole[1];
  return roles + interns * L.internshipMax + projects * L.projectBulletsMax;
}

/**
 * Every deterministic problem with a draft, each naming the bullet so the
 * review can fix exactly that one.
 */
export function checkResumeFormat(markdown: string, roleType: RoleType): FormatIssue[] {
  const r = parseResume(markdown);
  const issues: FormatIssue[] = [];
  const L = FORMAT_LIMITS;
  const jobs = r.experience.filter((e) => !e.internship);
  const interns = r.experience.filter((e) => e.internship);
  const allBullets = [...r.experience, ...r.projects].flatMap((e) => e.bullets);

  const total = allBullets.length;
  if (total > L.totalBullets[1]) {
    issues.push({ severity: "trim", message: `${total} bullets in total; the limit is ${L.totalBullets[1]}. Cut ${total - L.totalBullets[1]}, oldest and least relevant first, never the current role's impact.` });
  } else if (total < L.totalBullets[0] && total < perRoleCeiling(jobs.length, interns.length, r.projects.length, roleType)) {
    // Only when the roles have room: three roles and no projects cap out at
    // 6 + 6 + 1 = 13 (7 + 6 + 1 = 14 for leadership), and the per-role caps
    // win rather than padding.
    issues.push({ severity: "note", message: `${total} bullets in total; aim for ${L.totalBullets[0]}-${L.totalBullets[1]} if the bank supports more.` });
  }

  const budget = (entry: ResumeEntry | undefined, [min, max]: readonly [number, number], which: string) => {
    if (!entry) return;
    const n = entry.bullets.length;
    if (n > max) issues.push({ severity: "trim", message: `${which} (${label(entry)}) has ${n} bullets; the limit is ${max}. Cut the least relevant ${n - max}.` });
    else if (n < min) issues.push({ severity: "note", message: `${which} (${label(entry)}) has ${n} bullets; aim for ${min}-${max}.` });
  };
  budget(jobs[0], currentRoleLimit(roleType), "Current role");
  budget(jobs[1], L.previousRole, "Previous role");
  for (const intern of interns) {
    if (intern.bullets.length > L.internshipMax) {
      issues.push({ severity: "trim", message: `Internship (${label(intern)}) has ${intern.bullets.length} bullets; at most ${L.internshipMax}.` });
    }
  }
  for (const project of r.projects) {
    if (project.bullets.length > L.projectBulletsMax) {
      issues.push({ severity: "trim", message: `Project (${label(project)}) has ${project.bullets.length} bullets; one line each.` });
    }
  }
  if (roleType === "leadership" && r.projects.length > 0) {
    issues.push({ severity: "trim", message: "Projects on a leadership-track resume: remove the Projects section (never included for leadership roles)." });
  }

  const extra = r.skills;
  const stacks: { key: string; where: string }[] = [];
  for (const entry of [...r.experience, ...r.projects]) {
    entry.bullets.forEach((bullet, i) => {
      const where = `${label(entry)}, bullet ${i + 1} ("${preview(bullet)}")`;
      const words = countWords(bullet);
      if (words > L.bulletWords[1]) {
        issues.push({ severity: "trim", message: `${where} is ${words} words; trim to ${L.bulletWords[1]} or fewer, keeping the result in the first few words.` });
      } else if (words < L.bulletWords[0]) {
        issues.push({ severity: "note", message: `${where} is ${words} words; ${L.bulletWords[0]}-${L.bulletWords[1]} reads best, if there is real scope or result to add.` });
      }
      const parts = sentences(bullet);
      if (parts.length > 2) {
        issues.push({ severity: "trim", message: `${where} has ${parts.length} sentences; one, or two when the second lands a key result or metric.` });
      } else if (parts.length === 2 && !/\d/.test(parts[1])) {
        issues.push({ severity: "trim", message: `${where}: the second sentence carries no metric; merge it or cut it.` });
      }
      const tech = technologiesIn(bullet, extra);
      if (tech.length > L.techPerBullet) {
        issues.push({ severity: "trim", message: `${where} names ${tech.length} technologies (${tech.join(", ")}); at most ${L.techPerBullet}, the rest belong in Skills.` });
      }
      if (tech.length >= 2) stacks.push({ key: [...tech].sort().join(" + "), where });
    });
  }
  const seen = new Map<string, string>();
  for (const s of stacks) {
    const first = seen.get(s.key);
    if (first) issues.push({ severity: "trim", message: `${s.where} repeats the stack ${s.key} from ${first}; name a stack once.` });
    else seen.set(s.key, s.where);
  }

  if (r.skills.length > L.skills[1]) {
    issues.push({ severity: "trim", message: `Skills lists ${r.skills.length} items; keep the ${L.skills[1]} this posting values most, in its priority order.` });
  } else if (r.skills.length > 0 && r.skills.length < L.skills[0]) {
    issues.push({ severity: "note", message: `Skills lists ${r.skills.length} items; ${L.skills[0]}-${L.skills[1]} is the target.` });
  }

  if (r.summary) {
    const words = countWords(r.summary);
    if (roleType !== "leadership") {
      issues.push({ severity: "note", message: "A summary on a non-leadership target: keep it only for a domain change (and say so in the notes); otherwise remove it." });
    }
    if (words > L.summaryWordsMax) issues.push({ severity: "trim", message: `The summary is ${words} words; two lines, about ${L.summaryWordsMax} words at most.` });
    if (!/\d/.test(r.summary)) issues.push({ severity: "trim", message: "The summary has no concrete figure; include exactly one the bank supports." });
  } else if (roleType === "leadership") {
    issues.push({ severity: "note", message: "Leadership target with no summary: add two lines framing scope, with one concrete figure." });
  }

  const words = countWords(markdown.replace(/^#+.*$/gm, ""));
  if (words > L.totalWordsMax) {
    issues.push({ severity: "trim", message: `About ${words} words in all; over one page. Cut the oldest and least relevant bullets first, never recent impact.` });
  }
  return issues;
}

/** The checks as the review's instruction block; "" when there is nothing to fix. */
export function formatIssuesBlock(issues: FormatIssue[]): string {
  if (issues.length === 0) return "";
  const trim = issues.filter((i) => i.severity === "trim");
  const note = issues.filter((i) => i.severity === "note");
  return [
    "FORMAT CHECK (counted in code; the counts are exact, fix every MUST item):",
    ...trim.map((i) => `- MUST: ${i.message}`),
    ...note.map((i) => `- CONSIDER: ${i.message}`),
  ].join("\n");
}

/** A short summary for the notes: what still exceeds a limit after the review. */
export function formatIssuesNote(issues: FormatIssue[]): string {
  const trim = issues.filter((i) => i.severity === "trim");
  if (trim.length === 0) return "**Format check**\n- Within every limit (bullet counts, words per bullet, technologies, one page).";
  return ["**Format check** (still over a limit after the review)", ...trim.map((i) => `- ${i.message}`)].join("\n");
}

// ------------------------------------------------------------ the vault rules note

export type ResumeRule = { id: string; section: string; text: string };

/**
 * The rules note's bullets, numbered R1.. so the notes can cite which
 * applied. Every "## Section" counts (Clarifications, Never claim, Always,
 * and whatever Jake adds); text above the first section is the note's own
 * explanation, not a rule.
 */
export function parseResumeRules(markdown: string): ResumeRule[] {
  const rules: ResumeRule[] = [];
  let section: string | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (section && b && b[1].trim()) rules.push({ id: `R${rules.length + 1}`, section, text: b[1].trim() });
  }
  return rules;
}

export function rulesBlock(rules: ResumeRule[]): string {
  if (rules.length === 0) return "";
  return [
    "RESUME RULES (from the candidate's own rules note; HARD CONSTRAINTS that override the style guide and everything below, cite them by id):",
    ...rules.map((r) => `${r.id} [${r.section}] ${r.text}`),
  ].join("\n");
}

// ------------------------------------------------------------ voice exemplars

const OPENING_VERB = /^(?:[A-Z][a-z]+ed|Built|Led|Ran|Won|Drove|Wrote|Made|Grew|Cut|Set|Took|Shipped|Owned|Spearheaded|Rebuilt|Rewrote|Developed|Designed|Created)\b/;

/**
 * Bullets from Jake's own hand-written resumes, as the register to match.
 *
 * Bullet-shaped lines only (an opening verb, 12-45 words); ones with a
 * number first, since those show how he states a result. Taken evenly
 * from each file so both resumes' voices are represented.
 */
export function pickVoiceExemplars(texts: string[], count = 4): string[] {
  const per = Math.max(1, Math.ceil(count / Math.max(1, texts.length)));
  const out: string[] = [];
  for (const text of texts) {
    const candidates = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-•*▪●◦]\s*/, "").trim())
      .filter((l) => OPENING_VERB.test(l))
      .filter((l) => {
        const n = countWords(l);
        return n >= 12 && n <= 45;
      })
      .map((l, i) => ({ l, score: (/\d/.test(l) ? 2 : 0) + (countWords(l) <= 35 ? 1 : 0), i }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    let taken = 0;
    for (const c of candidates) {
      if (taken >= per) break;
      if (out.includes(c.l)) continue;
      out.push(c.l);
      taken += 1;
    }
  }
  return out.slice(0, count);
}
