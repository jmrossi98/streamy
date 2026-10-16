import { describe, it, expect } from "vitest";
import { LIVE_TABS, liveTabHref, parseLiveTab } from "../liveTabs";

describe("parseLiveTab", () => {
  it("opens the Now tab when the URL names none", () => {
    expect(parseLiveTab(null)).toBe("now");
    expect(parseLiveTab(undefined)).toBe("now");
    expect(parseLiveTab("")).toBe("now");
  });

  it("recognises every tab, case-insensitively", () => {
    for (const { key } of LIVE_TABS) {
      expect(parseLiveTab(key)).toBe(key);
      expect(parseLiveTab(key.toUpperCase())).toBe(key);
    }
  });

  it("falls back to Now rather than a blank page for an unknown tab", () => {
    expect(parseLiveTab("dvr")).toBe("now");
    expect(parseLiveTab("<script>")).toBe("now");
  });
});

describe("liveTabHref", () => {
  it("keeps the default tab on the bare path every existing link uses", () => {
    expect(liveTabHref("now")).toBe("/live");
  });

  it("names the other tabs in the query string", () => {
    expect(liveTabHref("guide")).toBe("/live?tab=guide");
    expect(liveTabHref("recordings")).toBe("/live?tab=recordings");
  });

  it("round-trips through the parser", () => {
    for (const { key } of LIVE_TABS) {
      const href = liveTabHref(key);
      const raw = new URL(href, "http://x").searchParams.get("tab");
      expect(parseLiveTab(raw)).toBe(key);
    }
  });
});
