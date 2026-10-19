import { describe, expect, it } from "vitest";
import { slowestSteps } from "../renderTiming";

describe("render timing", () => {
  it("names the slowest steps first, in seconds, and stops at five", () => {
    const steps: [string, number][] = [
      ["a", 120],
      ["b", 2140],
      ["c", 380],
      ["d", 10],
      ["e", 990],
      ["f", 2000],
    ];
    expect(slowestSteps(steps)).toBe("b 2.1s, f 2.0s, e 1.0s, c 0.4s, a 0.1s");
    expect(slowestSteps(steps, 2)).toBe("b 2.1s, f 2.0s");
    expect(steps[0][0]).toBe("a");
  });
});
