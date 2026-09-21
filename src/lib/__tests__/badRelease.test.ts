import { describe, it, expect } from "vitest";
import {
  classifyBadRelease,
  isPermanentlyBlocked,
  normalizeReleaseTitle,
  sameRelease,
  shouldSearchImmediately,
  MAX_IMMEDIATE_RESEARCHES_PER_HOUR,
} from "../downloadHealthRules";
import { describeRequestNotice } from "../requestNotice";
import { expireBlocklist, toQueueHealth } from "../radarr";

// The real record this exists for, captured from Radarr on 2026-09-21: a "1080p
// AMZN WEB-DL" of a film that had been in cinemas five days, whose only file was
// a single 1.1 GB .exe. Radarr left it at importPending forever.
const REAL_QUEUE_TITLE = "Resident Evil (2026) 1080p AMZN WEB-DL DDP5 1 H 264-FLUX.exe";
const REAL_BLOCKLIST_TITLE = "Resident Evil (2026) 1080p AMZN WEB DL DDP5 1 H 264 FLUX";
const REAL_HASH = "223913A3A93C74852B3949D46375DD237332B2E7";
const EXE_WARNING = {
  title: REAL_QUEUE_TITLE,
  messages: ["Caution: Found executable file with extension: '.exe'"],
};

describe("classifyBadRelease", () => {
  it("flags the real executable warning", () => {
    expect(classifyBadRelease({ statusMessages: [EXE_WARNING] })).toBe("executable");
  });

  it("flags Radarr's other dangerous-file wording", () => {
    expect(
      classifyBadRelease({
        statusMessages: [{ messages: ["Caution: Found potentially dangerous file with extension: '.lnk'"] }],
      })
    ).toBe("executable");
  });

  it("finds it among several messages", () => {
    expect(
      classifyBadRelease({
        statusMessages: [{ messages: ["Unable to determine if file is a sample"] }, EXE_WARNING],
      })
    ).toBe("executable");
  });

  it("leaves releases that need a human alone -- they may be legitimate", () => {
    // Throwing these away would delete real movies over an import quirk.
    expect(
      classifyBadRelease({
        statusMessages: [
          { messages: ["Found matching movie via grab history, but release was matched to movie by ID. Manual Import required."] },
        ],
      })
    ).toBeNull();
    expect(classifyBadRelease({ statusMessages: [{ messages: ["No files found are eligible for import in /data/x"] }] })).toBeNull();
    expect(classifyBadRelease({ statusMessages: [{ messages: ["Not a Custom Format upgrade for existing movie file(s)"] }] })).toBeNull();
  });

  it("handles no messages at all", () => {
    expect(classifyBadRelease({})).toBeNull();
    expect(classifyBadRelease({ statusMessages: [] })).toBeNull();
    expect(classifyBadRelease({ statusMessages: [{}] })).toBeNull();
  });
});

describe("sameRelease", () => {
  it("matches the queue's spelling to the blocklist's for the real release", () => {
    // The queue reports the torrent name with ".exe"; the blocklist stores the
    // title without it and with punctuation flattened. An exact compare misses
    // this pair, which is exactly the pair that has to match.
    expect(sameRelease(REAL_QUEUE_TITLE, REAL_BLOCKLIST_TITLE)).toBe(true);
    expect(sameRelease(REAL_BLOCKLIST_TITLE, REAL_QUEUE_TITLE)).toBe(true);
  });

  it("does not conflate different releases of the same film", () => {
    expect(sameRelease("Resident Evil (2026) 1080p WEB-DL-FLUX", "Resident Evil (2026) 1080p WEB-DL-NTb")).toBe(false);
    // A word-boundary prefix only: "flux" must not match "fluxx".
    expect(sameRelease("Some Movie 2026 FLUX", "Some Movie 2026 FLUXX")).toBe(false);
  });

  it("never matches an empty name", () => {
    expect(sameRelease("", "")).toBe(false);
    expect(sameRelease("...", "Some Movie")).toBe(false);
  });

  it("normalizes case and punctuation", () => {
    expect(normalizeReleaseTitle("Foo.Bar-BAZ (2026)")).toBe("foo bar baz 2026");
  });
});

describe("isPermanentlyBlocked", () => {
  const rejected = [{ releaseTitle: REAL_QUEUE_TITLE, downloadId: REAL_HASH }];

  it("keeps the blocklist entry for a rejected release, matched by title", () => {
    expect(isPermanentlyBlocked({ sourceTitle: REAL_BLOCKLIST_TITLE }, rejected)).toBe(true);
  });

  it("matches by info hash regardless of case, when the blocklist has one", () => {
    expect(isPermanentlyBlocked({ sourceTitle: "something else", torrentInfoHash: REAL_HASH.toLowerCase() }, rejected)).toBe(true);
  });

  it("lets an ordinary stalled release's entry expire", () => {
    expect(isPermanentlyBlocked({ sourceTitle: "Grizzly Man 2005 1080p BluRay x264", torrentInfoHash: "ABC" }, rejected)).toBe(false);
  });

  it("keeps nothing when nothing was rejected", () => {
    expect(isPermanentlyBlocked({ sourceTitle: REAL_BLOCKLIST_TITLE }, [])).toBe(false);
  });
});

describe("shouldSearchImmediately", () => {
  it("searches again straight away for the first few rejections", () => {
    expect(shouldSearchImmediately(1)).toBe(true);
    expect(shouldSearchImmediately(MAX_IMMEDIATE_RESEARCHES_PER_HOUR)).toBe(true);
  });

  it("stops chaining once a title keeps producing fakes", () => {
    expect(shouldSearchImmediately(MAX_IMMEDIATE_RESEARCHES_PER_HOUR + 1)).toBe(false);
  });
});

describe("toQueueHealth", () => {
  const base = { id: 684736251, title: REAL_QUEUE_TITLE, size: 1154026496, sizeleft: 0, status: "completed", downloadId: REAL_HASH };

  it("marks the real queue record unsafe and carries what removing it needs", () => {
    const h = toQueueHealth({ ...base, statusMessages: [EXE_WARNING] }, 38);
    expect(h.unsafe).toBe("executable");
    expect(h.queueId).toBe(684736251);
    expect(h.downloadId).toBe(REAL_HASH);
    expect(h.externalId).toBe(38);
  });

  it("leaves an ordinary finished download unmarked", () => {
    expect(toQueueHealth({ ...base }, 38).unsafe).toBeNull();
  });
});

describe("expireBlocklist", () => {
  const old = "2026-01-01T00:00:00Z";
  function fakeFetcher(records: object[]) {
    const deleted: number[][] = [];
    const fetcher = (async (path: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted.push(JSON.parse(String(init.body)).ids);
        return {};
      }
      expect(path).toContain("/api/v3/blocklist");
      return { records };
    }) as Parameters<typeof expireBlocklist>[0];
    return { fetcher, deleted };
  }

  it("expires old entries as before", async () => {
    const { fetcher, deleted } = fakeFetcher([{ id: 1, date: old, sourceTitle: "a" }, { id: 2, date: old, sourceTitle: "b" }]);
    await expireBlocklist(fetcher, 6, "test");
    expect(deleted).toEqual([[1, 2]]);
  });

  it("never expires an entry the caller says to keep, however old", async () => {
    // Without this the 6-hour TTL would un-block the fake and it would be grabbed again.
    const { fetcher, deleted } = fakeFetcher([
      { id: 1, date: old, sourceTitle: REAL_BLOCKLIST_TITLE },
      { id: 2, date: old, sourceTitle: "Grizzly Man 2005 1080p BluRay" },
    ]);
    await expireBlocklist(fetcher, 6, "test", (r) =>
      isPermanentlyBlocked(r, [{ releaseTitle: REAL_QUEUE_TITLE, downloadId: REAL_HASH }])
    );
    expect(deleted).toEqual([[2]]);
  });

  it("deletes nothing when everything old is kept", async () => {
    const { fetcher, deleted } = fakeFetcher([{ id: 1, date: old, sourceTitle: REAL_BLOCKLIST_TITLE }]);
    await expireBlocklist(fetcher, 6, "test", () => true);
    expect(deleted).toEqual([]);
  });
});

describe("describeRequestNotice", () => {
  const one = { count: 1, reason: "executable" as const };

  it("explains a bad release that is still in the queue", () => {
    const text = describeRequestNotice({ status: "downloading", replacing: "executable", rejections: null });
    expect(text).toMatch(/unsafe release/i);
    expect(text).toMatch(/executable/);
    expect(text).toMatch(/searching for another/i);
  });

  it("says a search for another release is running once the bad one is gone", () => {
    const text = describeRequestNotice({ status: "requested", replacing: null, rejections: one });
    expect(text).toMatch(/1 release rejected as unsafe/);
    expect(text).toMatch(/searching for another/i);
  });

  it("says outright when nothing else was found", () => {
    const text = describeRequestNotice({ status: "noReleaseFound", replacing: null, rejections: one });
    expect(text).toMatch(/no other release is available/i);
    expect(text).toMatch(/executable/);
  });

  it("pluralizes", () => {
    const text = describeRequestNotice({ status: "noReleaseFound", replacing: null, rejections: { count: 3, reason: "executable" } });
    expect(text).toMatch(/3 releases rejected/);
  });

  it("stays quiet when there is nothing to explain", () => {
    expect(describeRequestNotice({ status: "requested", replacing: null, rejections: null })).toBeNull();
    expect(describeRequestNotice({ status: "requested", replacing: null, rejections: { count: 0, reason: "executable" } })).toBeNull();
    // A healthy download or finished title doesn't need a history of what was skipped.
    expect(describeRequestNotice({ status: "downloading", replacing: null, rejections: one })).toBeNull();
    expect(describeRequestNotice({ status: "available", replacing: null, rejections: one })).toBeNull();
  });
});
