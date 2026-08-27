import { describe, it, expect } from "vitest";
import {
  describeChange,
  diffLines,
  extractElement,
  findKeywords,
  hashContent,
  htmlToText,
  isAllowedByRobots,
  newKeywordHits,
  normalizeLines,
  parseDateLine,
  parseKeywords,
  parseTourDates,
  shouldNotify,
  stripNoise,
} from "../pageWatchRules";

// This is the whole safety net for page watching. A bug here doesn't throw --
// it silently stops detecting changes, or reports a change on every run until
// the notifications get ignored. Neither is visible without tests.

describe("stripNoise", () => {
  it("removes scripts, styles and comments", () => {
    const html = `<div>Keep<script>var x = "<p>no</p>";</script><style>.a{}</style><!-- gone --></div>`;
    const out = stripNoise(html);
    expect(out).toContain("Keep");
    expect(out).not.toContain("var x");
    expect(out).not.toContain(".a{}");
    expect(out).not.toContain("gone");
  });
});

describe("extractElement", () => {
  const html = `
    <body>
      <nav>Menu</nav>
      <div id="tour"><div class="row">Mar 14 - Venue</div><div class="row">Mar 15 - Other</div></div>
      <footer>Footer</footer>
    </body>`;

  // The point of narrowing: nav and footer churn constantly and would
  // otherwise report a change every time the site tweaks its menu.
  it("extracts by id, excluding surrounding page furniture", () => {
    const out = extractElement(html, "#tour")!;
    expect(out).toContain("Mar 14");
    expect(out).toContain("Mar 15");
    expect(out).not.toContain("Menu");
    expect(out).not.toContain("Footer");
  });

  // The naive version stops at the first </div> and loses everything after it.
  it("counts nesting rather than stopping at the first closing tag", () => {
    const out = extractElement(html, "#tour")!;
    expect(out).toContain("Mar 15 - Other");
  });

  it("matches one class among several", () => {
    const out = extractElement(`<div class="a listing b">Inside</div>`, ".listing");
    expect(out).toBe("Inside");
  });

  // "row" must not match class="rowdy".
  it("does not match a class that is merely a prefix", () => {
    expect(extractElement(`<div class="rowdy">No</div>`, ".row")).toBeNull();
  });

  it("returns null for an unsupported selector or a missing element", () => {
    expect(extractElement(html, "div > .row")).toBeNull();
    expect(extractElement(html, "#nope")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("turns block elements into line breaks", () => {
    const text = htmlToText(`<ul><li>One</li><li>Two</li></ul>`);
    expect(normalizeLines(text)).toEqual(["One", "Two"]);
  });

  it("decodes named and numeric entities", () => {
    const text = htmlToText(`<p>Rock &amp; Roll &#8212; 8&#x3A;30&nbsp;pm</p>`);
    expect(normalizeLines(text)[0]).toBe("Rock & Roll — 8:30 pm");
  });
});

describe("normalizeLines", () => {
  // Without this, a clock in the footer changes the hash on every check and
  // the watch notifies forever.
  it("drops lines matching ignore patterns", () => {
    const lines = normalizeLines("Tour dates\nLast updated 14:32\nMar 14", [/^Last updated/]);
    expect(lines).toEqual(["Tour dates", "Mar 14"]);
  });
});

describe("hashContent", () => {
  it("is stable for identical content and differs for changed content", () => {
    expect(hashContent(["a", "b"])).toBe(hashContent(["a", "b"]));
    expect(hashContent(["a", "b"])).not.toBe(hashContent(["a", "c"]));
  });
});

describe("diffLines", () => {
  it("reports added and removed lines", () => {
    const d = diffLines(["a", "b"], ["b", "c"]);
    expect(d.added).toEqual(["c"]);
    expect(d.removed).toEqual(["a"]);
  });

  // A reordered listing is not news and must not notify.
  it("ignores ordering", () => {
    const d = diffLines(["a", "b"], ["b", "a"]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  // A second showing on the same date is a real addition.
  it("treats a repeated line as a change, not a duplicate", () => {
    const d = diffLines(["a"], ["a", "a"]);
    expect(d.added).toEqual(["a"]);
  });
});

describe("shouldNotify", () => {
  // Everything is "new" on the first check; mailing the whole page then is how
  // someone learns to filter these to trash.
  it("stays silent on the first check", () => {
    expect(shouldNotify(null, { added: ["a", "b"], removed: [] })).toBe(false);
  });

  it("notifies on a change against a known baseline", () => {
    expect(shouldNotify("abc", { added: ["a"], removed: [] })).toBe(true);
    expect(shouldNotify("abc", { added: [], removed: [] })).toBe(false);
  });
});

describe("describeChange", () => {
  it("summarises counts", () => {
    expect(describeChange({ added: ["a"], removed: ["b", "c"] })).toBe("1 added, 2 removed");
    expect(describeChange({ added: [], removed: [] })).toBe("no change");
  });
});

describe("keywords", () => {
  it("parses a comma-separated list, ignoring blanks and padding", () => {
    expect(parseKeywords(" presale, ,cancelled ")).toEqual(["presale", "cancelled"]);
    expect(parseKeywords(null)).toEqual([]);
  });

  it("matches case-insensitively and as a substring", () => {
    expect(findKeywords(["Presales start Friday"], ["presale"])).toEqual(["presale"]);
  });

  // A keyword sitting on the page permanently should notify once, when it
  // arrives -- not every few hours forever.
  it("only reports keywords in newly added lines", () => {
    const diff = { added: ["Show cancelled"], removed: [] };
    expect(newKeywordHits(diff, ["cancelled"])).toEqual(["cancelled"]);
    expect(newKeywordHits({ added: [], removed: [] }, ["cancelled"])).toEqual([]);
  });
});

describe("parseDateLine", () => {
  const YEAR = 2026;

  it("parses the formats a listing actually uses", () => {
    expect(parseDateLine("2026-03-14 Venue", YEAR)?.date).toBe("2026-03-14");
    expect(parseDateLine("03/14/2026 Venue", YEAR)?.date).toBe("2026-03-14");
    expect(parseDateLine("March 14, 2026 Venue", YEAR)?.date).toBe("2026-03-14");
    expect(parseDateLine("14 March 2026 Venue", YEAR)?.date).toBe("2026-03-14");
    expect(parseDateLine("Mar 14th Venue", YEAR)?.date).toBe("2026-03-14");
  });

  // Listings routinely omit the year; defaulting to 1900 or today's month
  // would sort the whole view wrongly.
  it("falls back to the reference year when none is given", () => {
    expect(parseDateLine("Mar 14", 2027)?.date).toBe("2027-03-14");
  });

  it("keeps the rest of the line as detail, and the original as raw", () => {
    const parsed = parseDateLine("Mar 14 - The Fillmore, San Francisco", YEAR)!;
    expect(parsed.detail).toBe("The Fillmore, San Francisco");
    expect(parsed.raw).toBe("Mar 14 - The Fillmore, San Francisco");
  });

  it("returns null when there is no date", () => {
    expect(parseDateLine("Upcoming shows", YEAR)).toBeNull();
    expect(parseDateLine("Notmonth 14", YEAR)).toBeNull();
  });
});

describe("parseTourDates", () => {
  it("picks dated lines out of a page and skips the rest", () => {
    const lines = ["Tour", "Mar 14 - Venue A", "Newsletter signup", "Apr 2 - Venue B"];
    const dates = parseTourDates(lines, 2026);
    expect(dates.map((d) => d.date)).toEqual(["2026-03-14", "2026-04-02"]);
  });

  // A paragraph mentioning a date in passing is not a listing entry.
  it("skips long prose lines", () => {
    const prose = "In March 14 years ago the band " + "x".repeat(200);
    expect(parseTourDates([prose], 2026)).toEqual([]);
  });
});

describe("isAllowedByRobots", () => {
  const robots = `
User-agent: *
Disallow: /private
Allow: /private/public

User-agent: StreamyWatch
Disallow: /nope
`;

  it("applies the wildcard group to an unlisted agent", () => {
    expect(isAllowedByRobots(robots, "/tour", "OtherBot")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/x", "OtherBot")).toBe(false);
  });

  // Longest match wins, per the spec -- otherwise the Allow is unreachable.
  it("prefers the longest matching rule", () => {
    expect(isAllowedByRobots(robots, "/private/public/x", "OtherBot")).toBe(true);
  });

  // Our own group replaces the wildcard rather than adding to it, so /private
  // is fair game for us while /nope is not.
  it("uses the agent-specific group when one matches", () => {
    expect(isAllowedByRobots(robots, "/nope", "StreamyWatch/1.0")).toBe(false);
    expect(isAllowedByRobots(robots, "/private", "StreamyWatch/1.0")).toBe(true);
  });

  // A missing or unhelpful robots.txt must not silently disable the feature.
  it("allows when there are no applicable rules", () => {
    expect(isAllowedByRobots("", "/tour", "StreamyWatch")).toBe(true);
    expect(isAllowedByRobots("User-agent: *\nDisallow:", "/tour", "StreamyWatch")).toBe(true);
  });
});
