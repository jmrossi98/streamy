import { describe, it, expect, afterEach } from "vitest";
import { resolveEgress, userAgent, isEgressProxied } from "../pageWatch";

// The egress rule is the line between anonymous and exposed, so it gets its own
// tests. A regression here wouldn't throw or fail a page check -- it would
// quietly route a request out of the box's real IP, which is exactly the thing
// this whole feature exists to prevent, and it would only be discovered by the
// watched site noticing who was polling it.

describe("resolveEgress", () => {
  it("routes through the proxy when one is set", () => {
    expect(resolveEgress("http://gluetun:8888", false)).toEqual({
      via: "proxy",
      url: "http://gluetun:8888",
    });
    // A set proxy is used even when not strictly required.
    expect(resolveEgress("http://gluetun:8888", true)).toEqual({
      via: "proxy",
      url: "http://gluetun:8888",
    });
  });

  it("allows a direct connection only when a proxy is not required", () => {
    expect(resolveEgress(null, false)).toEqual({ via: "direct" });
  });

  // The security-critical case: required but absent must block, never fall back
  // to direct. If this ever returns { via: "direct" }, the box is exposed.
  it("blocks rather than going direct when a proxy is required but missing", () => {
    expect(resolveEgress(null, true)).toEqual({ via: "blocked" });
    expect(resolveEgress("", true)).toEqual({ via: "blocked" });
  });
});

describe("userAgent", () => {
  const original = process.env.PAGE_WATCH_USER_AGENT;
  afterEach(() => {
    if (original === undefined) delete process.env.PAGE_WATCH_USER_AGENT;
    else process.env.PAGE_WATCH_USER_AGENT = original;
  });

  // The default must reveal nothing. Announcing the project or a personal
  // domain would re-attribute every request no matter what IP it exits from.
  it("defaults to a UA that names neither the project nor a personal domain", () => {
    delete process.env.PAGE_WATCH_USER_AGENT;
    const ua = userAgent().toLowerCase();
    expect(ua).not.toContain("streamy");
    expect(ua).not.toContain("jakob");
    expect(ua).not.toContain(".com");
    // Still a plausible UA string.
    expect(ua.length).toBeGreaterThan(10);
  });

  it("honours an override", () => {
    process.env.PAGE_WATCH_USER_AGENT = "CustomBot/2.0";
    expect(userAgent()).toBe("CustomBot/2.0");
  });
});

describe("isEgressProxied", () => {
  const original = process.env.PAGE_WATCH_PROXY_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.PAGE_WATCH_PROXY_URL;
    else process.env.PAGE_WATCH_PROXY_URL = original;
  });

  it("reflects whether a proxy URL is configured", () => {
    delete process.env.PAGE_WATCH_PROXY_URL;
    expect(isEgressProxied()).toBe(false);
    process.env.PAGE_WATCH_PROXY_URL = "http://gluetun:8888";
    expect(isEgressProxied()).toBe(true);
  });
});
