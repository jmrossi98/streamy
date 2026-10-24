/**
 * Which postings are worth surfacing: the right metros, and actually software
 * engineering.
 *
 * Pure and separate from the fetching so the judgement calls -- is "Ontario,
 * CA" the Bay Area, is a "Sales Engineer" a software role -- can be pinned
 * down in tests rather than argued about against a live feed.
 */

export type Metro = {
  key: string;
  label: string;
  /**
   * Matched case-insensitively on word boundaries against the posting's
   * location text.
   *
   * Boundaries rather than plain substrings are what make the short forms
   * safe: real postings write "NYC, Sea, SF, Tor", and a substring "sf" would
   * also fire inside other words. State abbreviations are still never
   * patterns -- "Buffalo, NY" is New York the state, not the metro.
   */
  patterns: string[];
};

/**
 * The metros being watched. Satellite cities are listed explicitly because a
 * posting says "Sunnyvale, CA" or "Bellevue, WA", never "Bay Area" or
 * "Seattle area" -- filtering on the headline city alone silently drops most
 * of the roles in that metro.
 */
export const METROS: Metro[] = [
  {
    key: "nyc",
    label: "New York",
    patterns: ["new york", "new york city", "nyc", "brooklyn", "manhattan"],
  },
  {
    key: "chicago",
    label: "Chicago",
    patterns: ["chicago", "evanston"],
  },
  {
    key: "la",
    label: "Los Angeles",
    patterns: [
      "los angeles",
      "santa monica",
      "culver city",
      "el segundo",
      "pasadena",
      "burbank",
      "playa vista",
    ],
  },
  {
    key: "bay",
    label: "SF Bay Area",
    patterns: [
      "san francisco",
      "bay area",
      "palo alto",
      "mountain view",
      "menlo park",
      "sunnyvale",
      "santa clara",
      "san jose",
      "cupertino",
      "redwood city",
      "foster city",
      "san mateo",
      "burlingame",
      "fremont",
      "milpitas",
      "los altos",
      "campbell",
      "oakland",
      "berkeley",
      "emeryville",
      // Written this way in multi-city strings: "NYC, Sea, SF, Tor".
      "sf",
    ],
  },
  {
    key: "seattle",
    label: "Seattle",
    patterns: ["seattle", "bellevue", "redmond", "kirkland", "sea"],
  },
];

function hasWord(hay: string, pattern: string): boolean {
  // Escaped because patterns are data; none contain regex metacharacters
  // today, but a city with a "." or "-" would otherwise change the meaning.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay);
}

/**
 * Every metro a posting's location text covers.
 *
 * Plural because postings routinely list several -- "San Francisco, Seattle",
 * "US-Chicago, US-New York", "New York, NY; San Francisco, CA; Seattle, WA".
 * Returning only the first would file a role that is open in four of the
 * watched cities under one of them, and hide it from the other three.
 */
export function matchMetros(location: string): Metro[] {
  return METROS.filter((metro) => metro.patterns.some((p) => hasWord(location, p)));
}

/** The first metro a location covers, or null. Convenience over matchMetros. */
export function matchMetro(location: string): Metro | null {
  return matchMetros(location)[0] ?? null;
}

/**
 * Whether a location is a US-remote role.
 *
 * Kept apart from the metros rather than folded in: "Remote" is not a place
 * the user asked for, but a remote US role is usually still worth seeing, so
 * it is a separate switch the caller decides on. Remote roles scoped to
 * another country are not a match.
 */
export function isUsRemote(location: string): boolean {
  const hay = location.toLowerCase();
  if (!hay.includes("remote")) return false;
  const nonUs = ["emea", "apac", "europe", "canada", "united kingdom", "india", "latam"];
  if (nonUs.some((r) => hay.includes(r))) return false;
  return true;
}

/**
 * The kinds of role worth surfacing.
 *
 * More than "software engineer" because that phrase misses most of what is
 * actually wanted here: a quant role is rarely titled engineer at all, firmware
 * and kernel work is usually named after the layer rather than the craft, and
 * security engineering is its own ladder. Each is a bucket a person would
 * recognise on a filter, not a taxonomy for its own sake.
 */
export type JobCategory =
  | "swe"
  | "ai"
  | "fde"
  | "quant"
  | "lowlevel"
  | "security"
  | "data"
  | "infra"
  | "mobile"
  | "graphics";

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  swe: "Software",
  ai: "AI / ML",
  fde: "Forward deployed",
  quant: "Quant",
  lowlevel: "Embedded",
  security: "Security",
  data: "Data",
  infra: "Infra / SRE",
  mobile: "Mobile",
  graphics: "Graphics / games",
};

/**
 * Ordered, and the order is the tie-break.
 *
 * A title can honestly match two buckets -- "Security Software Engineer" is
 * both -- so the more specific one is listed first and wins. Putting swe last
 * makes it the fallback it should be, rather than swallowing everything that
 * happens to contain the word engineer.
 */
const CATEGORY_PATTERNS: [JobCategory, string[]][] = [
  [
    "fde",
    ["forward deployed", "forward-deployed", "field engineer, solutions", "deployment engineer"],
  ],
  [
    "quant",
    [
      "quantitative research",
      "quantitative develop",
      "quantitative analyst",
      "quantitative trader",
      "quant research",
      "quant develop",
      "quant trader",
      "quantitative strateg",
      "algorithmic trading",
      "systematic trading",
    ],
  ],
  [
    "lowlevel",
    [
      "firmware",
      "embedded",
      "kernel",
      "device driver",
      "driver develop",
      "bios",
      "rtos",
      "bare metal",
      "compiler",
      "toolchain",
      "operating system",
      "systems software",
      "low level",
      "low-level",
      "fpga",
      "asic",
      "verification engineer",
      "silicon",
      "soc ",
    ],
  ],
  [
    "security",
    [
      "security engineer",
      // "Security Software Engineer" contains neither "security engineer" nor
      // anything else below -- the words are split by "software" -- so it fell
      // through to the generic bucket until this was added.
      "security software",
      "software security",
      "security architect",
      "security analyst",
      "security research",
      "application security",
      "product security",
      "offensive security",
      "penetration test",
      "red team",
      "blue team",
      "threat detection",
      "detection engineer",
      "incident response",
      "cryptograph",
      "appsec",
      "infosec",
      "cyber",
    ],
  ],
  [
    // Split out from data on request. The two overlap in job ads but not in
    // what someone is looking for: building models is a different job from
    // building the pipelines that feed them, and lumping them together made
    // the filter useless for either.
    "ai",
    [
      "ai engineer",
      "ai/ml",
      "ml/ai",
      "machine learning engineer",
      "ml engineer",
      "ml",
      "applied ai",
      "applied scientist",
      "research engineer",
      "deep learning",
      "generative ai",
      "genai",
      "llm",
      "large language model",
      "foundation model",
      "nlp engineer",
      "computer vision",
      "artificial intelligence",
    ],
  ],
  [
    // Science and engineering in one bucket, on request. They are different
    // jobs, but not different enough to be worth two filters here -- someone
    // scanning for data work wants to see both and can tell them apart from
    // the title.
    "data",
    [
      "data scientist",
      "data science",
      "decision scientist",
      "research scientist",
      "quantitative scientist",
      "experimentation",
      "statistician",
      "biostatistician",
      "econometric",
      "data engineer",
      "data platform engineer",
      "data infrastructure",
      "analytics engineer",
      "data analyst",
      "business intelligence",
      "mlops",
    ],
  ],
  [
    "infra",
    [
      "site reliability",
      "sre",
      "infrastructure engineer",
      "platform engineer",
      "devops",
      "cloud engineer",
      "distributed systems",
      "network engineer",
      "database engineer",
      "observability",
    ],
  ],
  ["mobile", ["ios engineer", "android engineer", "mobile engineer", "ios develop", "android develop", "react native"]],
  [
    "graphics",
    ["graphics engineer", "rendering engineer", "game engine", "gameplay engineer", "shader", "engine programmer", "gpu engineer"],
  ],
  [
    "swe",
    [
      "software engineer",
      "software developer",
      "backend engineer",
      "back-end engineer",
      "frontend engineer",
      "front-end engineer",
      "frontend developer",
      "front-end developer",
      "backend developer",
      "back-end developer",
      "full stack",
      "full-stack",
      "fullstack",
      "application engineer",
      "applications engineer",
      "application developer",
      "applications developer",
      "product engineer",
      "api engineer",
      "web engineer",
      "developer, ",
      "engineer, ",
      "sde",
      "swe",
      "member of technical staff",
    ],
  ],
];

/**
 * Titles that are not the job even though they carry the words.
 *
 * "engineer" alone catches sales engineers, recruiters for engineers and
 * mechanical engineers; "security" catches physical security guards; "quant"
 * catches quantitative UX researchers. Vetoing before matching is what keeps
 * the filters worth using.
 */
const ROLE_VETOES = [
  "sales engineer",
  "solutions engineer",
  "solution engineer",
  "customer engineer",
  "support engineer",
  "field engineer",
  "mechanical engineer",
  "hardware engineer, manufacturing",
  "electrical engineer",
  "manufacturing engineer",
  "chemical engineer",
  "civil engineer",
  "industrial engineer",
  "process engineer",
  "quality engineer",
  "test engineer",
  "facilities",
  "security guard",
  "security officer",
  "physical security",
  "recruiter",
  "recruiting",
  "sourcer",
  // Management titles that managementKind() did not accept (sales managers,
  // a bank's "Vice President" IC grade, a director of product) stay vetoed.
  "engineering manager",
  "director",
  "vp,",
  "vice president",
  // 2026-10-24: "manager" titles are now read, so the managers that are not
  // engineering managers are named here, or "Product Manager, Software
  // Engineering Tools" would land in Software.
  "program manager",
  "project manager",
  "product manager",
  "ux research",
  "user research",
];

/**
 * Whether a pattern appears in a title.
 *
 * Short patterns are matched on word boundaries, long ones as plain substrings.
 * "ml" has to be a word -- as a substring it is inside "html" -- and the same
 * goes for "sde", "swe", "sre" and "soc". Anything longer is distinctive enough
 * that a substring match is both correct and cheaper.
 */
function titleHas(hay: string, pattern: string): boolean {
  if (pattern.trim().length > 4) return hay.includes(pattern);
  return hasWord(hay, pattern.trim());
}

// -------------------------------------------------------------- management

/**
 * Software and engineering management, kept since 2026-10-24.
 *
 * Until then every manager, director and VP title was vetoed. Jake asked for
 * engineering managers to be kept under their own level, and for director and
 * VP of engineering roles to be kept when he could plausibly qualify -- which
 * a title cannot say, so "exec" postings are gated on the years the listing
 * asks for (jobManagementRules.ts). Tech leads are not management here: Jake
 * wants them under Lead / staff+, where they have always been.
 *
 * "em": Engineering Manager, Manager of Software Engineering, Software
 * Development Manager, Bloomberg's "Software Engineering Team Lead".
 * "exec": Director / VP / Head of engineering.
 */
export type ManagementKind = "em" | "exec";

/** A management title must say what it manages: software or engineering. */
const MANAGEMENT_SIGNALS = ["engineering", "software", "sde"];

/**
 * Managers of something other than software. Checked on the whole title, so
 * "Engineering Manager, Sales Engineering" goes too -- a rare false negative
 * worth the many sales, risk and delivery managers it keeps out.
 */
const MANAGEMENT_VETOES = [
  "sales",
  "account",
  "customer",
  "solutions",
  "solution engineer",
  "field",
  "support",
  "program manager",
  "project manager",
  "product manager",
  "product marketing",
  "marketing",
  "delivery manager",
  "communications",
  "risk",
  "compliance",
  "finance",
  "legal",
  "recruit",
  "talent",
  "facilities",
  "manufacturing",
  "mechanical",
  "electrical",
  "hardware",
  "civil",
  "construction",
  "quality",
  "test",
  "process engineer",
  "data center",
  "supply",
  "procurement",
  "sourcing",
  "product management",
  "people partner",
  "content",
];

const TECH_LEAD = ["tech lead", "technical lead"];

/** Whether a title is software/engineering management, and which kind. */
export function managementKind(title: string): ManagementKind | null {
  const hay = title.toLowerCase();
  if (TECH_LEAD.some((p) => hay.includes(p))) return null;
  if (!MANAGEMENT_SIGNALS.some((p) => titleHas(hay, p))) return null;
  // titleHas: "test" and "risk" as words, not inside "latest" or "brisk".
  if (MANAGEMENT_VETOES.some((v) => titleHas(hay, v))) return null;
  if (/\b(director|vp|svp|evp|vice president|head of)\b/.test(hay)) {
    // Banks use "Vice President" as an individual-contributor grade
    // ("Software Engineer - Vice President"): the person noun "engineer" with
    // no "of engineering" is that, not an executive role, and stays vetoed.
    if (/\bengineer\b/.test(hay)) return null;
    return "exec";
  }
  // An engineer title naming what it works on is an IC role, not a manager:
  // live postings on 2026-10-24 included "Software Engineer, Ads Manager",
  // "Software Engineer, Fleet Management" and "Identity & Access
  // Management". So "manager" (not "management") is required, and the
  // person noun "engineer"/"developer" rules it out.
  if (/\b(engineer|developer)s?\b/.test(hay)) return null;
  if (/\bmanager\b/.test(hay) || /\bteam lead(er)?\b/.test(hay)) return "em";
  return null;
}

/** The category a title belongs to, or null when it is not a role we want. */
export function classifyRole(title: string): JobCategory | null {
  const hay = title.toLowerCase();
  if (managementKind(title)) {
    // A manager of ML or security engineers is filed there like the
    // engineers are; an unmarked engineering manager is Software.
    for (const [category, patterns] of CATEGORY_PATTERNS) {
      if (patterns.some((p) => titleHas(hay, p))) return category;
    }
    return "swe";
  }
  if (ROLE_VETOES.some((v) => hay.includes(v))) return null;
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((p) => titleHas(hay, p))) return category;
  }
  return null;
}

/** Kept for callers that only need the yes/no. */
export function isSoftwareRole(title: string): boolean {
  return classifyRole(title) !== null;
}

// ------------------------------------------------------------------- level

/**
 * Seniority, as coarsely as a job title can honestly support.
 *
 * Three buckets because that is the real decision: is this below me, at me, or
 * above me. Mid and senior are deliberately one bucket -- they were split for a
 * few hours on 2026-09-28 and Jake did not want them treated differently.
 * Finer grades (L4 vs L5, II vs III) are not comparable between companies and
 * are mostly absent from titles anyway.
 */
export type JobLevel = "entry" | "midsenior" | "staff" | "management";

export const LEVEL_LABELS: Record<JobLevel, string> = {
  entry: "Entry / new grad",
  midsenior: "Mid / senior",
  staff: "Lead / staff+",
  // 2026-10-24: engineering managers, and the director/VP roles Jake could
  // qualify for (see managementKind). A separate ladder, so after staff.
  management: "Management",
};

/** Display order, junior to senior, then the management ladder. */
export const LEVEL_ORDER: JobLevel[] = ["entry", "midsenior", "staff", "management"];

/**
 * Checked before everything else, and worth stating why.
 *
 * "Senior Staff Engineer" is staff, not senior; "Staff Software Engineer,
 * New Grad Program" does not exist. So staff wins over senior, and entry wins
 * over nothing -- the order below is the tie-break, same as the categories.
 */
const LEVEL_PATTERNS: [JobLevel, string[]][] = [
  [
    "staff",
    [
      "staff",
      "principal",
      "distinguished",
      "fellow",
      "tech lead",
      "technical lead",
      "lead engineer",
      "lead software",
      "architect",
    ],
  ],
  [
    "entry",
    [
      "intern",
      "internship",
      "new grad",
      "new graduate",
      "university grad",
      "early career",
      "early-career",
      "entry level",
      "entry-level",
      "junior",
      "apprentice",
      "co-op",
      "campus",
      "graduate program",
    ],
  ],
  [
    // Explicit senior markers. Anything unmarked also lands here -- see below.
    "midsenior",
    ["senior", "sr.", "sr ", "mid-level", "mid level", "ii", "iii"],
  ],
];

/**
 * The level a title implies.
 *
 * An unmarked title returns midsenior rather than null. That is a convention
 * rather than a fact: a plain "Software Engineer" is an ordinary individual
 * contributor posting at almost every company here, and the alternative --
 * a fourth "unspecified" bucket -- would hold the majority of postings and
 * make the filter useless.
 */
export function classifyLevel(title: string): JobLevel {
  const hay = title.toLowerCase();
  // Before the staff patterns, so "Principal Engineering Manager" is a
  // manager; a tech lead never reaches here as one (managementKind).
  if (managementKind(title)) return "management";
  for (const [level, patterns] of LEVEL_PATTERNS) {
    if (patterns.some((p) => titleHas(hay, p))) return level;
  }
  return "midsenior";
}
