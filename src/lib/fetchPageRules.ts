/**
 * The rules behind the admin chat's fetch_page tool. Pure.
 *
 * fetch_page runs on Lightsail, which sits on the tailnet: from there
 * http://100.84.77.56:8989 is Sonarr with no login in front of it, and
 * 169.254.169.254 is the instance metadata service. A model can be steered by
 * the pages it reads, so the URL it asks for is treated as hostile -- only
 * public http(s) addresses, re-checked after DNS and on every redirect hop.
 * Added 2026-10-24 with the model-driven web tools.
 */

import { isIP } from "node:net";

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
/** Readable text handed to a cloud model; the local 8k-context model gets less. */
export const MAX_PAGE_CHARS = 12_000;

export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|ts\.net|home\.arpa)\.?$/i;

/** Syntax and hostname checks; DNS answers go through isPublicAddress. */
export function checkUrl(raw: string, base?: string): UrlVerdict {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "only http and https are fetched" };
  if (url.username || url.password) return { ok: false, reason: "URLs with credentials are not fetched" };
  const host = hostOf(url);
  if (!host) return { ok: false, reason: "no host" };
  if (isIP(host)) {
    return isPublicAddress(host) ? { ok: true, url } : { ok: false, reason: "private or reserved address" };
  }
  // A bare name ("sonarr", "mediabox") resolves through whatever search
  // domain the box has -- on a tailnet, MagicDNS. Public sites have a dot.
  if (!host.includes(".")) return { ok: false, reason: "not a public hostname" };
  if (BLOCKED_NAME.test(host)) return { ok: false, reason: "internal hostname" };
  return { ok: true, url };
}

/** The hostname without IPv6 brackets or a trailing dot. */
export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT -- every Tailscale address lives here
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, including the 169.254.169.254 metadata service
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4Public(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(net) & mask) >>> 0);
  });
}

/** Eight 16-bit groups, or null when it doesn't parse. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two groups.
  const quad = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (quad) {
    const n = v4ToInt(quad[1]);
    s = s.slice(0, -quad[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v6Public(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return false;
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry a v4 address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embeddedV4());
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Public(embeddedV4());
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local, Tailscale's fd7a:115c:a1e0::
  if ((g[0] & 0xffc0) === 0xfe80) return false; // link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g.slice(0, 6).every((x) => x === 0)) return false; // deprecated IPv4-compatible
  return true;
}

/** Whether a resolved address is somewhere on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip.replace(/^\[|\]$/g, ""));
  if (family === 4) return v4Public(ip);
  if (family === 6) return v6Public(ip.replace(/^\[|\]$/g, ""));
  return false;
}

/** Content types worth reading as text. A PDF or an image is refused, not mangled. */
export function isTextual(contentType: string | null): boolean {
  if (!contentType) return true;
  return /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml))/i.test(contentType.trim());
}

// ------------------------------------------------------------ extraction

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  cent: "¢",
  deg: "°",
  middot: "·",
  bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Elements whose whole content is chrome or code, never the article. */
const DROP_BLOCKS = ["script", "style", "noscript", "svg", "template", "iframe", "nav", "header", "footer", "aside", "form", "button", "select", "dialog", "canvas", "object"];

function dropBlocks(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROP_BLOCKS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
    // Unclosed (or self-closed) leftovers.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  return out;
}

function toText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|section|article|main|h[1-6]|li|ul|ol|tr|table|blockquote|pre|dd|dt|figure)\s*>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

function innerOf(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}\\s*>`, "i").exec(html);
  return m ? m[1] : null;
}

export type ExtractedPage = { title: string; text: string; links: string[] };

/**
 * A small readability pass: drop the chrome, prefer <article> or <main> when
 * it holds most of the words, keep headings and list structure as plain text.
 * Regex rather than a DOM -- no parser dependency for a tool whose output is
 * truncated to 12k characters anyway.
 */
export function extractReadable(html: string, pageUrl: string, maxChars = MAX_PAGE_CHARS): ExtractedPage {
  const title = toText(innerOf(html, "title") ?? "").replace(/\s+/g, " ").slice(0, 200);
  const links = extractLinks(html, pageUrl);
  const cleaned = dropBlocks(html);
  const body = innerOf(cleaned, "body") ?? cleaned;
  const whole = toText(body);
  let text = whole;
  for (const tag of ["article", "main"]) {
    const inner = innerOf(body, tag);
    if (!inner) continue;
    const candidate = toText(inner);
    // Only when it is the substance of the page, not a teaser box.
    if (candidate.length >= 400 && candidate.length >= whole.length * 0.4) {
      text = candidate;
      break;
    }
  }
  return { title, text: truncate(text, maxChars), links };
}

/** Absolute http(s) links on the page, de-duplicated, without fragments. */
export function extractLinks(html: string, pageUrl: string, max = 80): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      u.hash = "";
      out.add(u.toString());
    } catch {
      /* not a URL */
    }
    if (out.size >= max) break;
  }
  return [...out];
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return `${lastBreak > maxChars * 0.8 ? cut.slice(0, lastBreak) : cut}\n[... truncated ...]`;
}

/** The charset a Content-Type names, if TextDecoder knows it; utf-8 otherwise. */
export function charsetOf(contentType: string | null): string {
  const m = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? "");
  if (!m) return "utf-8";
  try {
    new TextDecoder(m[1]);
    return m[1];
  } catch {
    return "utf-8";
  }
}
