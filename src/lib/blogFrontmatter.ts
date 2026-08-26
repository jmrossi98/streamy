/**
 * Serialises a post to the exact frontmatter shape the website's parser
 * accepts.
 *
 * That parser (`src/lib/frontmatter.js` in jmrossi98/website) is hand-written,
 * not a YAML library, and supports only:
 *
 *   - scalars, plain or double-quoted:  key: value  /  key: "value"
 *   - inline arrays only:               key: [a, b, c]
 *   - literal booleans:                 true / false
 *
 * No nested objects, no block scalars, no single-quoted strings, no multi-line
 * values. Emitting anything else produces a post the site silently fails to
 * parse, so this module is deliberately conservative and thoroughly tested --
 * a bad publish is a broken deploy on a site Streamy can't see.
 */

export type BlogPostInput = {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  /** ISO date (YYYY-MM-DD). Defaults to today when omitted. */
  date?: string;
  draft?: boolean;
  /** ISO date (YYYY-MM-DD). Omitted from output when unset. */
  publishAt?: string | null;
};

/** Characters that force quoting, because the parser would misread them bare. */
const NEEDS_QUOTING = /[:#\[\]{}",\n]|^\s|\s$|^$/;

/**
 * Quotes a scalar only when it must be.
 *
 * Double quotes are the only quoting form the parser understands, so an
 * embedded double quote is escaped rather than switched to single quotes.
 * Newlines are replaced instead of escaped: the parser is line-based and would
 * treat a `\n` escape as a literal backslash-n, and a real newline as the end
 * of the value.
 */
export function serializeScalar(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ").trim();
  if (!NEEDS_QUOTING.test(flattened)) return flattened;
  return `"${flattened.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Tags as an inline array.
 *
 * Individual tags are normalised rather than quoted: the parser splits on
 * commas and doesn't handle a quoted element containing one, so a tag with a
 * comma in it cannot round-trip. Stripping the offending characters is the
 * honest option -- emitting something the site can't parse is worse.
 */
export function serializeTags(tags: string[]): string {
  const cleaned = tags
    .map((t) => t.trim().replace(/[,\[\]"\r\n]/g, "").trim())
    .filter(Boolean);
  return `[${cleaned.join(", ")}]`;
}

/** YYYY-MM-DD, which is what the site's date handling expects. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildPostFile(input: BlogPostInput): string {
  const lines = [
    "---",
    `title: ${serializeScalar(input.title)}`,
    `date: ${input.date || today()}`,
    `summary: ${serializeScalar(input.summary)}`,
    `tags: ${serializeTags(input.tags)}`,
    `draft: ${input.draft ? "true" : "false"}`,
  ];

  // Omitted entirely when unset. An empty publishAt would parse as a string
  // the site then compares against a date.
  if (input.publishAt) lines.push(`publishAt: ${input.publishAt}`);

  lines.push("---", "", input.body.trim(), "");
  return lines.join("\n");
}

/**
 * Filename-safe slug. The website derives the slug from the filename unless
 * frontmatter overrides it, so this becomes the post's URL.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    // Strip accents so "Café" becomes "cafe" rather than losing the letter.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validatePost(input: BlogPostInput, slug: string): ValidationResult {
  if (!input.title.trim()) return { ok: false, reason: "Title is required." };
  if (!input.body.trim()) return { ok: false, reason: "Post body is required." };
  if (!slug) return { ok: false, reason: "Title must contain at least one letter or number." };

  const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
  if (input.date && !dateFormat.test(input.date)) {
    return { ok: false, reason: "Date must be YYYY-MM-DD." };
  }
  if (input.publishAt && !dateFormat.test(input.publishAt)) {
    return { ok: false, reason: "Publish date must be YYYY-MM-DD." };
  }

  // The body is markdown and may legitimately contain "---", but a line of
  // exactly three dashes at the very start would be read as a second
  // frontmatter block opening.
  if (input.body.trimStart().startsWith("---")) {
    return { ok: false, reason: "Body can't begin with ---; add a line of text above it." };
  }

  return { ok: true };
}
