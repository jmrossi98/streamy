import { describe, expect, it } from "vitest";
import { assessJellyfinEdgeBlocks, ELEVATED_EDGE_BLOCKS } from "../securityRules";

/**
 * The security panel used to render every Jellyfin sign-in attempt, which
 * duplicated the visitor log. What the visitor log cannot answer is the
 * question that panel exists for -- is something being actively refused right
 * now -- so the count stayed and the per-event list went.
 */
describe("assessJellyfinEdgeBlocks", () => {
  it("reports nothing blocked as reassurance, not silence", () => {
    const [f] = assessJellyfinEdgeBlocks(0);
    expect(f.severity).toBe("info");
    expect(f.detail).toContain("No addresses");
  });

  it("treats a couple of blocks as ordinary background probing", () => {
    // A publicly reachable Jellyfin gets knocked on. Firing here would train
    // the admin to ignore the panel, which is worse than not having it.
    for (const n of [1, 2, ELEVATED_EDGE_BLOCKS - 1]) {
      expect(assessJellyfinEdgeBlocks(n)[0].severity).toBe("info");
    }
  });

  it("warns once blocks rise above background", () => {
    const [f] = assessJellyfinEdgeBlocks(ELEVATED_EDGE_BLOCKS);
    expect(f.severity).toBe("warning");
    expect(f.detail).toContain(String(ELEVATED_EDGE_BLOCKS));
  });

  it("keeps the id stable across counts so alerting can dedupe", () => {
    // The Finding contract says ids must not embed counts -- alerting dedupes
    // on them, and an id that changes every time an attacker adds an address
    // would page on every increment.
    const a = assessJellyfinEdgeBlocks(ELEVATED_EDGE_BLOCKS)[0].id;
    const b = assessJellyfinEdgeBlocks(ELEVATED_EDGE_BLOCKS + 40)[0].id;
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d/);
  });

  it("always returns exactly one finding", () => {
    // The panel counts passing checks; returning two for one condition would
    // inflate "N passing checks" without adding information.
    for (const n of [0, 3, 5, 100]) {
      expect(assessJellyfinEdgeBlocks(n)).toHaveLength(1);
    }
  });
});
