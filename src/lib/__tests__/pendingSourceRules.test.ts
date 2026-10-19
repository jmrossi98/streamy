import { describe, it, expect } from "vitest";
import { pendingNotice, pendingSource, SOURCE_POLL_EVERY_MS, SOURCE_POLL_FOR_MS } from "../pendingSourceRules";

describe("pendingSource", () => {
  it("is indexing when Sonarr already has the file", () => {
    expect(pendingSource("available")).toBe("indexing");
  });

  it("is missing for anything else, including no answer", () => {
    expect(pendingSource("requested")).toBe("missing");
    expect(pendingSource("noReleaseFound")).toBe("missing");
    expect(pendingSource(undefined)).toBe("missing");
    expect(pendingSource(null)).toBe("missing");
  });
});

describe("pendingNotice", () => {
  it("says the file is coming when it is only being indexed", () => {
    const n = pendingNotice("indexing", "S1 E1");
    expect(n.title).toBe("Downloaded, almost ready");
    expect(n.body).toContain("S1 E1 is on the server");
    expect(n.body).not.toContain("Download it");
  });

  it("asks for a download when there is none, and before the answer is in", () => {
    expect(pendingNotice("missing", "S1 E1").body).toContain("Download it from the episode list");
    expect(pendingNotice(null, "S1 E1").title).toBe("Not downloaded yet");
  });
});

describe("polling", () => {
  it("asks often enough to catch a scan, and stops eventually", () => {
    expect(SOURCE_POLL_EVERY_MS).toBeLessThanOrEqual(10_000);
    expect(SOURCE_POLL_FOR_MS).toBeGreaterThanOrEqual(2 * 60_000);
  });
});
