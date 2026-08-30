import { describe, it, expect, afterEach } from "vitest";
import { supportsNativeHls } from "../hlsSupport";

// Regression: the first version checked canPlayType('application/vnd.apple.
// mpegurl') for a non-empty result. Chrome answers "maybe" for that MIME
// type despite having no real ability to play HLS -- a plain <video
// src="*.m3u8"> just hangs forever (readyState 0, networkState loading, no
// error ever fired) -- so the check routed every desktop browser through
// HLS and broke playback everywhere, not just fixed the mobile Safari case
// it was meant for. Tightening to `=== "probably"` isn't safe either --
// that distinction is documented as unreliable across Safari versions. UA/
// vendor sniffing is what actually holds up.
function stubNavigator(vendor: string, userAgent: string) {
  Object.defineProperty(globalThis, "navigator", { value: { vendor, userAgent }, configurable: true });
}

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const SAFARI_MACOS =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

describe("supportsNativeHls", () => {
  afterEach(() => {
    stubNavigator("Google Inc.", CHROME_WINDOWS);
  });

  it("is false for desktop Chrome (the regression case)", () => {
    stubNavigator("Google Inc.", CHROME_WINDOWS);
    expect(supportsNativeHls()).toBe(false);
  });

  it("is true for desktop Safari", () => {
    stubNavigator("Apple Computer, Inc.", SAFARI_MACOS);
    expect(supportsNativeHls()).toBe(true);
  });

  it("is true for iOS Safari -- the case this exists for", () => {
    stubNavigator("Apple Computer, Inc.", SAFARI_IOS);
    expect(supportsNativeHls()).toBe(true);
  });

  it("is false for Chrome on iOS, even though it's WebKit-based", () => {
    // CriOS reports an Apple vendor too -- has to be excluded by name, not vendor alone.
    stubNavigator("Apple Computer, Inc.", CHROME_IOS);
    expect(supportsNativeHls()).toBe(false);
  });

  it("is false for Firefox", () => {
    stubNavigator("", FIREFOX_WINDOWS);
    expect(supportsNativeHls()).toBe(false);
  });
});
