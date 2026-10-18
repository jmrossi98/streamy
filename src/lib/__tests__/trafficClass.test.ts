import { describe, expect, it } from "vitest";
import { classifyTraffic } from "../trafficClass";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1";

describe("classifyTraffic", () => {
  it("tags self-identifying crawlers as bots, by name", () => {
    expect(
      classifyTraffic({ userAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", asn: null })
    ).toEqual({ class: "bot", reason: "AhrefsBot" });
    expect(
      classifyTraffic({ userAgent: "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)", asn: null }).class
    ).toBe("bot");
    expect(
      classifyTraffic({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1)",
        asn: null,
      }).class
    ).toBe("bot");
    expect(
      classifyTraffic({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36",
        asn: null,
      }).class
    ).toBe("bot");
  });

  it("tags a missing user agent as a bot", () => {
    expect(classifyTraffic({ userAgent: null, asn: null }).class).toBe("bot");
  });

  it("tags a normal browser on a cloud network as likely bot", () => {
    expect(classifyTraffic({ userAgent: IPHONE, asn: 14618, org: "AMAZON-AES" })).toEqual({
      class: "likely-bot",
      reason: "Amazon AWS data center",
    });
  });

  it("tags a normal browser on an ISP as human", () => {
    expect(classifyTraffic({ userAgent: IPHONE, asn: 22773, org: "ASN-CXA-ALL-CCI-22773-RDC" })).toEqual({
      class: "human",
      reason: "on ASN-CXA-ALL-CCI-22773-RDC",
    });
  });

  it("does not treat Cloudflare (iCloud Private Relay / WARP) as a data center", () => {
    expect(classifyTraffic({ userAgent: IPHONE, asn: 13335 }).class).toBe("human");
  });

  it("does not mistake ordinary browsers for bots", () => {
    for (const ua of [
      IPHONE,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/152.0.7977.64 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    ]) {
      expect(classifyTraffic({ userAgent: ua, asn: null }).class).toBe("human");
    }
  });
});
