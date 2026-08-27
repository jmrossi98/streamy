/**
 * Pure logic for watching a web page: turning HTML into comparable text,
 * deciding whether it changed, and pulling dates out of it.
 *
 * Deliberately dependency-free and side-effect-free. Everything here is
 * exercised by unit tests, because the alternative is discovering that
 * extraction broke only when a change notification fails to fire -- silently,
 * on a page nobody is watching by hand.
 *
 * The fetching, storage and notification half lives in pageWatch.ts.
 */

import { createHash } from "node:crypto";

/** Elements whose contents are never page content. */
const NOISE_ELEMENTS = ["script", "style", "noscript", "svg", "head", "template", "iframe"];

/** Tags that imply a line break when flattening to text. */
const BLOCK_TAGS =
  /<\/?(p|div|section|article|header|footer|nav|ul|ol|li|tr|td|th|h[1-6]|br|hr|table|tbody|thead|main|aside|figure|blockquote|dt|dd)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

/** Strips comments and any element whose content is never page content. */
export function stripNoise(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of NOISE_ELEMENTS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    // Self-closing or unclosed variants, which would otherwise survive above.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/>`, "gi"), " ");
  }
  return out;
}

/**
 * Inner HTML of the first element matching `#id` or `.class`, or null.
 *
 * This is not a CSS engine and does not pretend to be one -- only those two
 * forms are supported, which covers "narrow this to the tour-dates container"
 * without taking on a parser dependency. Nesting is handled by counting
 * opening and closing tags of the same name, so a container full of nested
 * divs returns the whole container rather than stopping at the first </div>.
 */
export function extractElement(html: string, selector: string): string | null {
  const match = /^([#.])([A-Za-z0-9_-]+)$/.exec(selector.trim());
  if (!match) return null;
  const [, kind, name] = match;

  const attr = kind === "#" ? "id" : "class";
  // For class, match it as one entry in a possibly multi-valued attribute.
  const value =
    kind === "#"
      ? `["']${name}["']`
      : `["'][^"']*\\b${name}\\b[^"']*["']`;
  const opener = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\b${attr}\\s*=\\s*${value}[^>]*>`, "i");

  const start = opener.exec(html);
  if (!start) return null;

  const tag = start[1];
  const contentStart = start.index + start[0].length;

  // Void elements never have content worth extracting.
  if (/\/>$/.test(start[0])) return "";

  const scan = new RegExp(`<(\\/?)${tag}\\b[^>]*?(\\/?)>`, "gi");
  scan.lastIndex = contentStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html)) !== null) {
    const closing = m[1] === "/";
    const selfClosing = m[2] === "/";
    if (selfClosing) continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, m.index);
  }
  // Unbalanced markup: take the rest rather than failing the whole check.
  return html.slice(contentStart);
}

/** Flattens HTML to text, preserving block structure as line breaks. */
export function htmlToText(html: string): string {
  let out = stripNoise(html);
  out = out.replace(BLOCK_TAGS, "\n");
  out = out.replace(/<[^>]+>/g, " ");
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char);
  }
  // Numeric entities, decimal and hex.
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  // Collapse runs of spaces/tabs but keep newlines, which carry the structure.
  out = out.replace(/[^\S\n]+/g, " ");
  return out;
}

/**
 * Text to a stable list of comparable lines.
 *
 * `ignore` drops lines matching any of the given patterns. That is what makes
 * change detection usable on a real page: a "last updated" stamp or a rotating
 * advert would otherwise report a change on every single check, and an alert
 * that always fires is an alert nobody reads.
 */
export function normalizeLines(text: string, ignore: RegExp[] = []): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !ignore.some((re) => re.test(l)));
}

/** Stable hash of normalized content. Same lines in, same hash out. */
export function hashContent(lines: string[]): string {
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export type ContentDiff = { added: string[]; removed: string[] };

/**
 * Set-style line diff.
 *
 * Multiset, not set: a line appearing twice where it previously appeared once
 * is a real change on a listing page (a date added a second showing), so
 * counts are tracked rather than deduplicated. Order is ignored, because a
 * reordered listing is not news.
 */
export function diffLines(before: string[], after: string[]): ContentDiff {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);

  const added: string[] = [];
  for (const line of after) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added.push(line);
  }

  const removed: string[] = [];
  for (const [line, n] of counts) {
    for (let i = 0; i < n; i++) removed.push(line);
  }

  return { added, removed };
}

export function hasChanges(diff: ContentDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0;
}

/**
 * One-line human summary of a diff, for an email subject or a panel row.
 *
 * Capped in length: this ends up in an SNS subject, which rejects newlines and
 * truncates past 100 characters.
 */
export function describeChange(diff: ContentDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (!parts.length) return "no change";
  return parts.join(", ");
}

/** Full change detail, for the notification body and the admin panel. */
export function formatDiff(diff: ContentDiff, maxLines = 40): string {
  const lines: string[] = [];
  for (const l of diff.added.slice(0, maxLines)) lines.push(`+ ${l}`);
  if (diff.added.length > maxLines) lines.push(`  ... ${diff.added.length - maxLines} more added`);
  for (const l of diff.removed.slice(0, maxLines)) lines.push(`- ${l}`);
  if (diff.removed.length > maxLines) {
    lines.push(`  ... ${diff.removed.length - maxLines} more removed`);
  }
  return lines.join("\n");
}

/**
 * Notify only on a change against a known previous state.
 *
 * The first successful check of a new page establishes the baseline and must
 * stay silent: everything on the page is "new" at that point, and mailing the
 * entire page contents as a change is how someone learns to ignore these.
 */
export function shouldNotify(previousHash: string | null, diff: ContentDiff): boolean {
  if (previousHash === null) return false;
  return hasChanges(diff);
}

export type TourDate = {
  /** ISO date (YYYY-MM-DD) when confidently parseable, else null. */
  date: string | null;
  /** The line with the date portion removed -- venue, city, status. */
  detail: string;
  /** The original line, kept so nothing is lost to a parsing mistake. */
  raw: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Pulls a date off the front of a listing line.
 *
 * Handles the formats a tour listing actually uses. A two-digit or absent year
 * is resolved against `referenceYear` -- tour listings routinely omit the year,
 * and reading "Mar 14" as year 2001 would sort the whole listing wrongly.
 *
 * Returns null when nothing date-like is found, which is the common case for
 * headings and navigation text that survive extraction.
 */
export function parseDateLine(line: string, referenceYear: number): TourDate | null {
  const patterns: { re: RegExp; take: (m: RegExpExecArray) => string | null }[] = [
    // 2026-03-14
    {
      re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
      take: (m) => iso(Number(m[1]), Number(m[2]), Number(m[3])),
    },
    // 03/14/2026 or 3/14/26 -- US order, which is what English-language
    // listing sites overwhelmingly use.
    {
      re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/,
      take: (m) => {
        const y = Number(m[3]);
        return iso(y < 100 ? 2000 + y : y, Number(m[1]), Number(m[2]));
      },
    },
    // March 14, 2026 / Mar 14 / Mar 14 2026
    {
      re: /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/,
      take: (m) => {
        const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (!mo) return null;
        return iso(m[3] ? Number(m[3]) : referenceYear, mo, Number(m[2]));
      },
    },
    // 14 March 2026 / 14 Mar
    {
      re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{4}))?\b/,
      take: (m) => {
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (!mo) return null;
        return iso(m[3] ? Number(m[3]) : referenceYear, mo, Number(m[1]));
      },
    },
  ];

  for (const { re, take } of patterns) {
    const m = re.exec(line);
    if (!m) continue;
    const date = take(m);
    if (!date) continue;
    const detail = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length))
      .replace(/\s+/g, " ")
      .replace(/^[\s\-–—•|,]+|[\s\-–—•|,]+$/g, "")
      .trim();
    return { date, detail, raw: line };
  }
  return null;
}

/**
 * Every line that looks like a dated listing entry.
 *
 * Generic on purpose. Once the actual site is known this can be tightened to
 * its markup, but a heuristic pass over extracted text works without knowing
 * anything about the page, and gives the panel something to show on day one.
 */
export function parseTourDates(lines: string[], referenceYear: number): TourDate[] {
  const out: TourDate[] = [];
  for (const line of lines) {
    // Long prose lines with an incidental date are not listing entries.
    if (line.length > 200) continue;
    const parsed = parseDateLine(line, referenceYear);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Splits a stored comma-separated keyword list into usable terms. */
export function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Keywords present in a set of lines, matched case-insensitively.
 *
 * Substring rather than whole-word: a watch for "presale" should still fire on
 * "Presales", and the cost of an occasional loose match is a notification you
 * glance at, while the cost of a missed match is the thing you were watching
 * for going by unnoticed.
 */
export function findKeywords(lines: string[], keywords: string[]): string[] {
  const hay = lines.join("\n").toLowerCase();
  return keywords.filter((k) => hay.includes(k.toLowerCase()));
}

/**
 * Keywords that have just appeared.
 *
 * Only the added lines are searched, so a keyword sitting on the page
 * permanently notifies once when it arrives rather than every few hours
 * forever. Same state-change rule the SNS health alerts already follow --
 * an alert that always fires is one nobody reads.
 */
export function newKeywordHits(diff: ContentDiff, keywords: string[]): string[] {
  return findKeywords(diff.added, keywords);
}

/**
 * Whether robots.txt permits fetching `path`.
 *
 * A deliberately small implementation: it reads `User-agent` groups, applies
 * the most specific matching group (our token over `*`), and honours `Allow`
 * and `Disallow` by longest-match-wins as the spec directs. No crawl-delay, no
 * wildcards beyond a trailing `*`, no sitemap handling -- none of which affect
 * whether we may fetch one page.
 *
 * Unparseable or missing robots.txt means allowed: that is how a fetch behaves
 * anyway, and treating an absent file as a prohibition would make the feature
 * silently do nothing.
 */
export function isAllowedByRobots(robotsTxt: string, path: string, agent: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    }
  }

  const lowerAgent = agent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && lowerAgent.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  const group = specific ?? wildcard;
  if (!group) return true;

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    // An empty Disallow means "allow everything" and matches nothing.
    if (rule.path === "") continue;
    const literal = rule.path.endsWith("*") ? rule.path.slice(0, -1) : rule.path;
    if (!path.startsWith(literal)) continue;
    if (!best || literal.length > best.length) {
      best = { allow: rule.allow, length: literal.length };
    }
  }
  return best ? best.allow : true;
}

/**
 * User-Agent for outbound watch requests.
 *
 * Deliberately names neither this project nor any personal domain: announcing
 * one would re-attribute every request regardless of the IP it exits from,
 * defeating the point of a VPN egress. It still identifies as a generic bot so
 * robots.txt user-agent groups can match it -- compliant, not merely quiet.
 *
 * Pure and env-only, so it lives here with the rest of the tested logic rather
 * than in pageWatch.ts, which pulls in the database and the network.
 */
export function userAgent(): string {
  return process.env.PAGE_WATCH_USER_AGENT?.trim() || "Mozilla/5.0 (compatible; PageWatch/1.0)";
}

/** Configured egress proxy URL, or null. */
export function egressProxyUrl(): string | null {
  const value = process.env.PAGE_WATCH_PROXY_URL?.trim();
  return value ? value : null;
}

/** Whether a missing proxy must hard-fail rather than fetch direct. */
export function egressProxyRequired(): boolean {
  const value = process.env.PAGE_WATCH_REQUIRE_PROXY?.toLowerCase().trim();
  return value === "1" || value === "true" || value === "yes";
}

/** Whether an anonymising egress proxy is active, for the admin panel. */
export function isEgressProxied(): boolean {
  return egressProxyUrl() !== null;
}

export type EgressDecision =
  | { via: "proxy"; url: string }
  | { via: "direct" }
  | { via: "blocked" };

/**
 * The one rule that decides how a watch request leaves the box, kept pure so it
 * can be unit tested -- it is the difference between anonymous and exposed.
 *
 * - a proxy is set         -> go through it
 * - none set, not required -> direct (fine for local dev)
 * - none set, required     -> blocked, never direct
 *
 * The last line is the whole point: when anonymity is required, the safe
 * failure is to send nothing, because a single direct request leaks an IP that
 * DNS ties straight back to the owner.
 */
export function resolveEgress(url: string | null, required: boolean): EgressDecision {
  if (url) return { via: "proxy", url };
  return required ? { via: "blocked" } : { via: "direct" };
}
