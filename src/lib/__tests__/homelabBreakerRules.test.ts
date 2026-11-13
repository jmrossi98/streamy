import { describe, expect, it } from "vitest";
import {
  HOST_UP,
  PROBE_EVERY_DOWN_MS,
  PROBE_EVERY_UP_MS,
  errorCode,
  homelabTargets,
  hostOf,
  isUnreachable,
  offlineBannerText,
  onProbe,
  onRequestUnreachable,
  probeDelayMs,
  summarize,
} from "../homelabBreakerRules";

describe("homelabTargets", () => {
  it("probes each homelab host once, on the first service listed for it", () => {
    expect(
      homelabTargets({
        JELLYFIN_URL: "http://100.84.77.56:8096",
        SONARR_URL: "http://100.84.77.56:8989",
        RADARR_URL: "https://other.example:7878/",
        PROWLARR_URL: "https://ts-box.tail1234.ts.net",
      })
    ).toEqual([
      { host: "100.84.77.56", port: 8096 },
      { host: "other.example", port: 7878 },
      { host: "ts-box.tail1234.ts.net", port: 443 },
    ]);
  });

  it("leaves out loopback, blanks and junk", () => {
    expect(
      homelabTargets({ JELLYFIN_URL: "http://localhost:8096", SONARR_URL: "", RADARR_URL: "not a url", SABNZBD_URL: "ftp://x:21" })
    ).toEqual([]);
  });
});

describe("hostOf", () => {
  it("reads a string, a URL or a Request-like object", () => {
    expect(hostOf("http://100.84.77.56:8096/Sessions")).toBe("100.84.77.56");
    expect(hostOf(new URL("https://API.TheMovieDB.org/3/x"))).toBe("api.themoviedb.org");
    expect(hostOf({ url: "http://100.84.77.56:8989/api" })).toBe("100.84.77.56");
  });

  it("is null for what it can't read", () => {
    expect(hostOf("/api/relative")).toBeNull();
    expect(hostOf(undefined)).toBeNull();
    expect(hostOf(42)).toBeNull();
  });
});

describe("isUnreachable", () => {
  // undici's shape: TypeError("fetch failed") with the real error as its cause.
  const fetchFailed = (code: string) => new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });

  it("is the host not answering, found down the cause chain", () => {
    expect(isUnreachable(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe(true);
    expect(isUnreachable(fetchFailed("EHOSTUNREACH"))).toBe(true);
    expect(errorCode(fetchFailed("ENETUNREACH"))).toBe("ENETUNREACH");
  });

  it("is not a service refusing, a slow answer or our own timeout", () => {
    expect(isUnreachable(fetchFailed("ECONNREFUSED"))).toBe(false);
    expect(isUnreachable(fetchFailed("UND_ERR_HEADERS_TIMEOUT"))).toBe(false);
    expect(isUnreachable(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(false);
    expect(isUnreachable(new Error("plain"))).toBe(false);
  });
});

describe("the breaker's state", () => {
  it("opens after two failed probes, not one", () => {
    const one = onProbe(HOST_UP, false, 1000, "no answer in 3000 ms");
    expect(one.down).toBe(false);
    const two = onProbe(one, false, 16000, "no answer in 3000 ms");
    expect(two).toMatchObject({ down: true, since: 16000, probeFailures: 2 });
    // Staying down keeps when it went down.
    expect(onProbe(two, false, 21000).since).toBe(16000);
  });

  it("closes on one good probe", () => {
    const down = onRequestUnreachable(HOST_UP, 5000, "UND_ERR_CONNECT_TIMEOUT");
    expect(down).toMatchObject({ down: true, since: 5000 });
    expect(onProbe(down, true, 9000)).toEqual(HOST_UP);
  });

  it("checks often while down", () => {
    expect(probeDelayMs([HOST_UP])).toBe(PROBE_EVERY_UP_MS);
    expect(probeDelayMs([HOST_UP, { ...HOST_UP, down: true, since: 1 }])).toBe(PROBE_EVERY_DOWN_MS);
    // One failed probe is checked again soon, so a dead host is confirmed fast.
    expect(probeDelayMs([onProbe(HOST_UP, false, 1)])).toBe(PROBE_EVERY_DOWN_MS);
  });

  it("is offline while any host is down, since the earliest", () => {
    expect(summarize([HOST_UP])).toEqual({ online: true, downSince: null });
    expect(summarize([{ ...HOST_UP, down: true, since: 300 }, { ...HOST_UP, down: true, since: 200 }])).toEqual({
      online: false,
      downSince: 200,
    });
  });
});

describe("offlineBannerText", () => {
  it("says what doesn't work and what does", () => {
    expect(offlineBannerText(null)).toBe(
      "The home media server has been offline, so movies, shows and live TV won't play right now. Browsing and My List still work."
    );
    expect(offlineBannerText(0, () => "3:12 PM")).toMatch(/^The home media server has been offline since 3:12 PM, so/);
  });
});
