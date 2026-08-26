import { describe, it, expect } from "vitest";
import {
  buildPostFile,
  serializeScalar,
  serializeTags,
  slugify,
  validatePost,
} from "../blogFrontmatter";

// The website's parser is hand-written and supports only plain/double-quoted
// scalars, inline arrays, and literal booleans. Emitting anything else means a
// post the site silently fails to parse, on a site Streamy can't see -- so
// these tests are the safety net for that gap.

describe("serializeScalar", () => {
  it("leaves a simple value unquoted", () => {
    expect(serializeScalar("Hello world")).toBe("Hello world");
  });

  // A colon is the parser's key/value separator, so an unquoted title
  // containing one would truncate at the colon.
  it("quotes values containing a colon", () => {
    expect(serializeScalar("Streamy: a year in")).toBe('"Streamy: a year in"');
  });

  it("quotes values containing brackets, braces, commas or hashes", () => {
    for (const v of ["a [b]", "a {b}", "a, b", "a # b"]) {
      expect(serializeScalar(v).startsWith('"')).toBe(true);
    }
  });

  // Double quotes are the only quoting form the parser understands, so an
  // embedded quote has to be escaped rather than switched to single quotes.
  it("escapes embedded double quotes", () => {
    expect(serializeScalar('He said "hi"')).toBe('"He said \\"hi\\""');
  });

  // The parser is line-based: a real newline would end the value, and a \n
  // escape would come back as a literal backslash-n.
  it("flattens newlines rather than escaping them", () => {
    const out = serializeScalar("line one\nline two");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\\n");
    expect(out).toContain("line one line two");
  });

  it("quotes values with leading or trailing whitespace, and empty values", () => {
    expect(serializeScalar("  padded")).toBe("padded");
    expect(serializeScalar("")).toBe('""');
  });
});

describe("serializeTags", () => {
  it("emits an inline array", () => {
    expect(serializeTags(["one", "two"])).toBe("[one, two]");
  });

  it("emits an empty array for no tags", () => {
    expect(serializeTags([])).toBe("[]");
  });

  it("drops blank entries", () => {
    expect(serializeTags(["a", "  ", "b"])).toBe("[a, b]");
  });

  // The parser splits on commas and can't handle a quoted element containing
  // one, so a comma inside a tag cannot round-trip. Stripping it beats
  // emitting something unparseable.
  it("strips characters that would break the inline array", () => {
    expect(serializeTags(['a,b', 'c"d', "e[f]"])).toBe("[ab, cd, ef]");
  });
});

describe("buildPostFile", () => {
  const base = { title: "Test Post", summary: "A summary", tags: ["x"], body: "Body text." };

  it("emits the exact field order and delimiters the parser expects", () => {
    const out = buildPostFile({ ...base, date: "2026-08-26" });
    expect(out.split("\n").slice(0, 7)).toEqual([
      "---",
      "title: Test Post",
      "date: 2026-08-26",
      "summary: A summary",
      "tags: [x]",
      "draft: false",
      "---",
    ]);
  });

  it("writes booleans as literals, not quoted strings", () => {
    expect(buildPostFile({ ...base, draft: true })).toContain("draft: true");
    expect(buildPostFile({ ...base, draft: false })).toContain("draft: false");
  });

  // An empty publishAt would parse as a string the site then compares to a
  // date, so it is left out entirely rather than emitted blank.
  it("omits publishAt when unset", () => {
    expect(buildPostFile(base)).not.toContain("publishAt");
    expect(buildPostFile({ ...base, publishAt: null })).not.toContain("publishAt");
    expect(buildPostFile({ ...base, publishAt: "2026-09-01" })).toContain("publishAt: 2026-09-01");
  });

  it("defaults the date to today in YYYY-MM-DD", () => {
    expect(buildPostFile(base)).toMatch(/\ndate: \d{4}-\d{2}-\d{2}\n/);
  });

  it("puts the body after the closing delimiter and ends with a newline", () => {
    const out = buildPostFile({ ...base, body: "  Hello.  " });
    expect(out.endsWith("Hello.\n")).toBe(true);
    expect(out.indexOf("Hello.")).toBeGreaterThan(out.lastIndexOf("---"));
  });

  it("survives a title that would otherwise break parsing", () => {
    const out = buildPostFile({ ...base, title: 'Why "Q5" beats: Q4, sometimes' });
    const titleLine = out.split("\n").find((l) => l.startsWith("title:"))!;
    expect(titleLine).toBe('title: "Why \\"Q5\\" beats: Q4, sometimes"');
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World Again")).toBe("hello-world-again");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Streamy: a year in!! (really)")).toBe("streamy-a-year-in-really");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("keeps accented letters as their base form rather than dropping them", () => {
    expect(slugify("Café life")).toBe("cafe-life");
  });

  it("returns empty for a title with nothing usable", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("does not end on a hyphen after truncation", () => {
    expect(slugify("a ".repeat(100)).endsWith("-")).toBe(false);
  });
});

describe("validatePost", () => {
  const ok = { title: "T", summary: "s", tags: [], body: "b" };

  it("accepts a complete post", () => {
    expect(validatePost(ok, "t").ok).toBe(true);
  });

  it("rejects a missing title or body", () => {
    expect(validatePost({ ...ok, title: "  " }, "t").ok).toBe(false);
    expect(validatePost({ ...ok, body: "  " }, "t").ok).toBe(false);
  });

  it("rejects a title that produces no slug", () => {
    expect(validatePost({ ...ok, title: "!!!" }, "").ok).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(validatePost({ ...ok, date: "26-08-2026" }, "t").ok).toBe(false);
    expect(validatePost({ ...ok, publishAt: "next tuesday" }, "t").ok).toBe(false);
    expect(validatePost({ ...ok, date: "2026-08-26" }, "t").ok).toBe(true);
  });

  // A body starting with --- would read as a second frontmatter block opening.
  it("rejects a body starting with a frontmatter delimiter", () => {
    expect(validatePost({ ...ok, body: "---\nnope" }, "t").ok).toBe(false);
    expect(validatePost({ ...ok, body: "intro\n\n---\n\nmore" }, "t").ok).toBe(true);
  });
});
