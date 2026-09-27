import { describe, expect, it } from "vitest";
import { withDeadline } from "../withDeadline";

const after = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("withDeadline", () => {
  it("returns the real value when it arrives in time", async () => {
    await expect(withDeadline(after(5, "done"), "fallback", 200)).resolves.toBe("done");
  });

  it("returns the fallback when the work is too slow", async () => {
    await expect(withDeadline(after(200, "done"), "fallback", 10)).resolves.toBe("fallback");
  });

  it("returns the fallback when the work rejects", async () => {
    // Slow and broken are the same outcome for a panel: nothing to show.
    await expect(withDeadline(Promise.reject(new Error("nope")), "fallback", 200)).resolves.toBe(
      "fallback"
    );
  });

  it("does not leave the rejection unhandled after falling back", async () => {
    const rejects = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("late")), 30)
    );
    await expect(withDeadline(rejects, "fallback", 5)).resolves.toBe("fallback");
    // Give the late rejection a chance to surface as unhandled if it were.
    await after(50, null);
  });

  it("passes arrays through as the fallback type", async () => {
    await expect(withDeadline(after(200, [1, 2]), [] as number[], 10)).resolves.toEqual([]);
  });
});
