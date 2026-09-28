import { describe, expect, it } from "vitest";
import { classifyPlayRejection, hlsFatalAction, HLS_FATAL_RETRIES } from "../playbackErrorRules";

const domError = (name: string) => Object.assign(new Error(name), { name });

describe("classifyPlayRejection", () => {
  it("ignores a play() interrupted by a new source load", () => {
    expect(classifyPlayRejection(domError("AbortError"))).toBe("ignore");
  });

  it("asks for a gesture when autoplay is blocked", () => {
    expect(classifyPlayRejection(domError("NotAllowedError"))).toBe("needs-gesture");
  });

  it("treats anything else as a real failure", () => {
    expect(classifyPlayRejection(domError("NotSupportedError"))).toBe("fail");
    expect(classifyPlayRejection(undefined)).toBe("fail");
  });
});

describe("hlsFatalAction", () => {
  it("restarts loading on network errors and recovers media errors", () => {
    expect(hlsFatalAction("networkError", 0)).toBe("restart-load");
    expect(hlsFatalAction("mediaError", 1)).toBe("recover-media");
  });

  it("gives up after the retry budget, and on other fatal types", () => {
    expect(hlsFatalAction("networkError", HLS_FATAL_RETRIES)).toBe("give-up");
    expect(hlsFatalAction("muxError", 0)).toBe("give-up");
  });
});
