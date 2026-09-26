import { describe, expect, it } from "vitest";
import { boardUrl, parseBoard, parseJobSources, type JobSource } from "../jobBoards";

const stripe: JobSource = { company: "Stripe", provider: "greenhouse", slug: "stripe" };
const ramp: JobSource = { company: "Ramp", provider: "ashby", slug: "ramp" };

describe("parseBoard", () => {
  it("reads Greenhouse's real shape", () => {
    // Taken from the live endpoint on 2026-09-26: id is a number, location is
    // nested under {name}, and the apply link is absolute_url.
    const payload = {
      jobs: [
        {
          id: 8172508,
          title: "Abuse Investigator",
          location: { name: "Dublin" },
          absolute_url: "https://stripe.com/jobs/search?gh_jid=8172508",
          updated_at: "2026-09-25T16:45:00-04:00",
        },
      ],
    };
    expect(parseBoard(stripe, payload)).toEqual([
      {
        id: "greenhouse:stripe:8172508",
        company: "Stripe",
        title: "Abuse Investigator",
        location: "Dublin",
        url: "https://stripe.com/jobs/search?gh_jid=8172508",
        postedAt: "2026-09-25T16:45:00-04:00",
      },
    ]);
  });

  it("reads Ashby's shape, where location is a plain string", () => {
    const payload = {
      jobs: [
        {
          id: "abc-123",
          title: "Software Engineer, Platform",
          location: "New York, NY",
          jobUrl: "https://jobs.ashbyhq.com/ramp/abc-123",
          publishedAt: "2026-09-20T00:00:00Z",
        },
      ],
    };
    const [posting] = parseBoard(ramp, payload);
    expect(posting.id).toBe("ashby:ramp:abc-123");
    expect(posting.location).toBe("New York, NY");
    expect(posting.url).toBe("https://jobs.ashbyhq.com/ramp/abc-123");
  });

  it("accepts a bare array as well as {jobs}", () => {
    expect(parseBoard(ramp, [{ id: "1", title: "SWE", location: "Chicago" }])).toHaveLength(1);
  });

  it("falls back to a constructed apply link when the payload has none", () => {
    const [posting] = parseBoard(stripe, { jobs: [{ id: 42, title: "SWE" }] });
    expect(posting.url).toBe("https://boards.greenhouse.io/stripe/jobs/42");
    // Unspecified rather than an empty string, so the UI has something to show.
    expect(posting.location).toBe("Unspecified");
    expect(posting.postedAt).toBeNull();
  });

  it("drops entries with no id or no title rather than rendering blank rows", () => {
    // These feeds are third party and occasionally carry drafts.
    const payload = {
      jobs: [
        { id: 1, title: "" },
        { title: "No id here" },
        null,
        "nonsense",
        { id: 2, title: "Real One" },
      ],
    };
    expect(parseBoard(stripe, payload).map((p) => p.title)).toEqual(["Real One"]);
  });

  it("returns nothing for a payload of the wrong shape", () => {
    expect(parseBoard(stripe, null)).toEqual([]);
    expect(parseBoard(stripe, { error: "nope" })).toEqual([]);
  });
});

describe("boardUrl", () => {
  it("builds the documented public endpoints", () => {
    expect(boardUrl(stripe)).toBe("https://boards-api.greenhouse.io/v1/boards/stripe/jobs");
    expect(boardUrl(ramp)).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp");
  });

  it("encodes the slug, which comes from configuration", () => {
    expect(boardUrl({ ...stripe, slug: "a b" })).toContain("a%20b");
  });
});

describe("parseJobSources", () => {
  it("parses provider:slug and an optional display name", () => {
    expect(parseJobSources("greenhouse:stripe, ashby:ramp:Ramp Inc")).toEqual([
      { provider: "greenhouse", slug: "stripe", company: "stripe" },
      { provider: "ashby", slug: "ramp", company: "Ramp Inc" },
    ]);
  });

  it("accepts newline separation too", () => {
    expect(parseJobSources("greenhouse:a\nashby:b")).toHaveLength(2);
  });

  it("ignores unknown providers rather than half-configuring them", () => {
    // A provider that is not implemented would silently return nothing, which
    // looks exactly like a company with no open roles.
    expect(parseJobSources("lever:plaid,greenhouse:ok")).toEqual([
      { provider: "greenhouse", slug: "ok", company: "ok" },
    ]);
  });

  it("ignores malformed entries", () => {
    expect(parseJobSources("greenhouse")).toEqual([]);
    expect(parseJobSources("greenhouse:")).toEqual([]);
    expect(parseJobSources("")).toEqual([]);
    expect(parseJobSources(null)).toEqual([]);
  });
});
