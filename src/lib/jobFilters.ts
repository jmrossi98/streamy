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
 * Titles that are software engineering.
 *
 * Positive match on the usual spellings, then a veto list -- "engineer" alone
 * is far too broad. A sales engineer, a recruiter for engineers and a
 * mechanical engineer all carry the word, and letting them through would bury
 * the roles actually being looked for.
 */
const ROLE_PATTERNS = [
  "software engineer",
  "software developer",
  "backend engineer",
  "back-end engineer",
  "frontend engineer",
  "front-end engineer",
  "full stack",
  "full-stack",
  "fullstack",
  "infrastructure engineer",
  "platform engineer",
  "systems engineer",
  "distributed systems",
  "site reliability",
  "sre",
  "machine learning engineer",
  "ml engineer",
  "developer, ",
  "engineer, ",
  "sde",
  "swe",
];

const ROLE_VETOES = [
  "sales engineer",
  "solutions engineer",
  "solution engineer",
  "customer engineer",
  "support engineer",
  "field engineer",
  "mechanical engineer",
  "hardware engineer",
  "electrical engineer",
  "manufacturing engineer",
  "chemical engineer",
  "civil engineer",
  "industrial engineer",
  "process engineer",
  "quality engineer",
  "test engineer",
  "recruiter",
  "recruiting",
  "sourcer",
  "engineering manager",
  "director",
  "vp,",
  "vice president",
];

export function isSoftwareRole(title: string): boolean {
  const hay = title.toLowerCase();
  if (ROLE_VETOES.some((v) => hay.includes(v))) return false;
  return ROLE_PATTERNS.some((p) => hay.includes(p));
}
