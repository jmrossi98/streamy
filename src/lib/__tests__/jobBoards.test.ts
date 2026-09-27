import { describe, expect, it } from "vitest";
import { boardUrl, parseBoard, parseJobSources, type JobSource } from "../jobBoards";
import { matchMetros } from "../jobFilters";

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

describe("workday", () => {
  const nvidia: JobSource = {
    company: "Nvidia",
    provider: "workday",
    slug: "nvidia/wd5/NVIDIAExternalCareerSite",
  };

  it("builds the tenant/dc/site endpoint", () => {
    expect(boardUrl(nvidia)).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs"
    );
  });

  it("parses the live payload shape", () => {
    // Verbatim from the endpoint on 2026-09-26: no absolute url, id buried in
    // bulletFields, location as prose.
    const payload = {
      total: 2000,
      jobPostings: [
        {
          title: "Software Engineer, OpenShell",
          externalPath: "/job/US-Remote/Software-Engineer--OpenShell_JR1997726",
          locationsText: "US, Remote",
          postedOn: "Posted Today",
          bulletFields: ["JR1997726"],
        },
      ],
    };
    expect(parseBoard(nvidia, payload)).toEqual([
      {
        id: "workday:nvidia:JR1997726",
        company: "Nvidia",
        title: "Software Engineer, OpenShell",
        location: "US, Remote",
        url: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-Remote/Software-Engineer--OpenShell_JR1997726",
        // "Posted Today" is prose, not a date. "New" is measured by when we
        // first saw it anyway.
        postedAt: null,
      },
    ]);
  });

  it("keeps a collapsed multi-location string rather than inventing places", () => {
    // Workday answers "2 Locations" and omits them. The metro matcher then
    // declines it, which is correct -- guessing would file it anywhere.
    const [posting] = parseBoard(nvidia, {
      jobPostings: [
        { title: "Software Engineer, SONiC", externalPath: "/job/x_JR1", locationsText: "2 Locations", bulletFields: ["JR1"] },
      ],
    });
    expect(posting.location).toBe("2 Locations");
    expect(matchMetros(posting.location)).toEqual([]);
  });

  it("rejects a malformed workday slug rather than fetching a URL that cannot exist", () => {
    expect(parseJobSources("workday:nvidia:Nvidia")).toEqual([]);
    expect(parseJobSources("workday:nvidia/wd5:Nvidia")).toEqual([]);
    expect(parseJobSources("workday:nvidia/x5/Site:Nvidia")).toEqual([]);
    expect(parseJobSources("workday:nvidia/wd5/Site:Nvidia")).toEqual([
      { provider: "workday", slug: "nvidia/wd5/Site", company: "Nvidia" },
    ]);
  });
});

describe("eightfold", () => {
  const netflix: JobSource = {
    company: "Netflix",
    provider: "eightfold",
    slug: "explore.jobs.netflix.net/netflix.com",
  };

  it("builds the host/domain endpoint", () => {
    expect(boardUrl(netflix)).toBe(
      "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&start=0&num=50"
    );
  });

  it("parses the live payload, keeping every location", () => {
    // Verbatim shape from the endpoint on 2026-09-27. Unlike Workday, a
    // multi-site role lists its places, so all of them survive into the
    // metro matcher rather than collapsing to "2 Locations".
    const payload = {
      count: 484,
      positions: [
        {
          id: 790298014263,
          name: "AI Engineer 6 - AI Foundation & Tooling",
          location: "Remote, United States",
          locations: ["New York, New York", "Los Gatos, California"],
          t_update: 1779148800,
          canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790298014263",
        },
      ],
    };
    const [posting] = parseBoard(netflix, payload);
    expect(posting.id).toBe("eightfold:netflix.com:790298014263");
    expect(posting.location).toBe("New York, New York; Los Gatos, California");
    expect(posting.url).toBe("https://explore.jobs.netflix.net/careers/job/790298014263");
    expect(posting.postedAt).toBe(new Date(1779148800 * 1000).toISOString());
    // Both places are visible to the metro matcher, which is the point.
    expect(matchMetros(posting.location).map((m) => m.key)).toContain("nyc");
  });

  it("falls back to the single location string when there is no array", () => {
    const [posting] = parseBoard(netflix, {
      positions: [{ id: 1, name: "Software Engineer", location: "Remote, United States" }],
    });
    expect(posting.location).toBe("Remote, United States");
    expect(posting.postedAt).toBeNull();
  });

  it("rejects a slug that is not host/domain", () => {
    expect(parseJobSources("eightfold:netflix:Netflix")).toEqual([]);
    expect(parseJobSources("eightfold:explore.jobs.netflix.net:Netflix")).toEqual([]);
    expect(parseJobSources("eightfold:explore.jobs.netflix.net/netflix.com:Netflix")).toEqual([
      {
        provider: "eightfold",
        slug: "explore.jobs.netflix.net/netflix.com",
        company: "Netflix",
      },
    ]);
  });
});

describe("single-company APIs", () => {
  const spotify: JobSource = { company: "Spotify", provider: "spotify", slug: "engineering" };
  const github: JobSource = { company: "GitHub", provider: "github", slug: "engineer" };

  it("builds each company's own endpoint", () => {
    expect(boardUrl(spotify)).toBe(
      "https://api.lifeatspotify.com/wp-json/animal/v1/job/search?c=engineering"
    );
    expect(boardUrl(github)).toContain("https://www.github.careers/api/jobs?keywords=engineer");
  });

  it("parses Spotify's shape, keeping every location", () => {
    // Verbatim from the endpoint on 2026-09-27: the title is `text`, and a
    // role open in several places lists them all.
    const payload = {
      result: [
        {
          id: "senior-backend-data-engineer-content-intelligence",
          text: "Senior Backend Data Engineer, Content Intelligence",
          locations: [{ location: "New York, NY" }, { location: "Stockholm" }],
        },
      ],
    };
    const [posting] = parseBoard(spotify, payload);
    expect(posting.id).toBe("spotify:senior-backend-data-engineer-content-intelligence");
    expect(posting.title).toBe("Senior Backend Data Engineer, Content Intelligence");
    expect(posting.location).toBe("New York, NY; Stockholm");
    expect(matchMetros(posting.location).map((m) => m.key)).toContain("nyc");
  });

  it("parses GitHub's nested shape", () => {
    // Everything useful is one level down under `data`.
    const payload = {
      totalCount: 68,
      jobs: [
        {
          data: {
            slug: "software-engineer-copilot",
            req_id: "R12345",
            title: "Software Engineer, Copilot",
            location_name: "San Francisco",
            country: "United States",
          },
        },
      ],
    };
    const [posting] = parseBoard(github, payload);
    expect(posting.id).toBe("github:R12345");
    expect(posting.location).toBe("San Francisco, United States");
    expect(posting.url).toContain("software-engineer-copilot");
  });

  it("ignores a payload that is not the expected shape", () => {
    expect(parseBoard(spotify, { error: "nope" })).toEqual([]);
    expect(parseBoard(github, { jobs: [{ notData: 1 }] })).toEqual([]);
  });
});

describe("atlassian", () => {
  const atlassian: JobSource = { company: "Atlassian", provider: "atlassian", slug: "all" };

  it("parses the bare array it returns", () => {
    // The plainest of the three single-company APIs: no wrapper, no nesting,
    // and it hands back a real apply URL rather than a slug to rebuild from.
    const payload = [
      {
        id: 12345,
        title: "Senior Software Engineer, Jira",
        locations: ["San Francisco, California", "Remote, United States"],
        applyUrl: "https://www.atlassian.com/company/careers/details/12345",
      },
    ];
    const [posting] = parseBoard(atlassian, payload);
    expect(posting.id).toBe("atlassian:12345");
    expect(posting.location).toBe("San Francisco, California; Remote, United States");
    expect(posting.url).toBe("https://www.atlassian.com/company/careers/details/12345");
    expect(matchMetros(posting.location).map((m) => m.key)).toContain("bay");
  });

  it("copes with a single location that is not an array", () => {
    const [posting] = parseBoard(atlassian, [
      { id: 1, title: "Engineer", locations: "Austin, Texas" },
    ]);
    expect(posting.location).toBe("Austin, Texas");
  });

  it("ignores a wrapped payload, since this endpoint returns a bare list", () => {
    expect(parseBoard(atlassian, { jobs: [{ id: 1, title: "x" }] })).toEqual([]);
  });
});

describe("microsoft, via the shared custom parser", () => {
  const microsoft: JobSource = {
    company: "Microsoft",
    provider: "microsoft",
    slug: "software engineer",
  };

  it("reads the endpoint that actually serves the careers page", () => {
    // apply.careers.microsoft.com, not the gcsservices host every guide names
    // -- found by watching the page, not by guessing.
    expect(boardUrl(microsoft)).toContain("apply.careers.microsoft.com/api/pcsx/search");
    expect(boardUrl(microsoft)).toContain("query=software%20engineer");
  });

  it("digs the postings out of data.positions and keeps the real posted date", () => {
    // Verbatim shape from the endpoint on 2026-09-27. Microsoft is the only
    // one of these that gives a usable timestamp.
    const payload = {
      status: 200,
      data: {
        count: 900,
        positions: [
          {
            id: 1970393556992027,
            displayJobId: "200054590",
            name: "Software Engineer II/Sr. Software Engineer",
            locations: ["United States, Washington, Redmond"],
            standardizedLocations: ["Redmond, WA, US"],
            postedTs: 1790282962,
          },
        ],
      },
    };
    const [posting] = parseBoard(microsoft, payload);
    expect(posting.id).toBe("microsoft:200054590");
    expect(posting.title).toBe("Software Engineer II/Sr. Software Engineer");
    // The standardized field, not the prose one -- it is what the metro
    // matcher can actually read.
    expect(posting.location).toBe("Redmond, WA, US");
    expect(matchMetros(posting.location).map((m) => m.key)).toContain("seattle");
    expect(posting.postedAt).toBe(new Date(1790282962 * 1000).toISOString());
  });

  it("returns nothing when the nested path is absent", () => {
    expect(parseBoard(microsoft, { status: 200, data: {} })).toEqual([]);
    expect(parseBoard(microsoft, { error: "nope" })).toEqual([]);
  });
});
