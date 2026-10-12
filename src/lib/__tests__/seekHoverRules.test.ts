import { describe, it, expect } from "vitest";
import { seekHover } from "../seekHoverRules";

describe("pointing at the seek bar", () => {
  it("maps the pointer to a time, snapped so a sweep is not a seek per pixel", () => {
    expect(seekHover(500, 1000, 3600).seconds).toBe(1800);
    expect(seekHover(501, 1000, 3600).seconds).toBe(1805);
    expect(seekHover(500.4, 1000, 3600).seconds).toBe(1800);
  });

  it("stays inside the title", () => {
    expect(seekHover(-20, 1000, 3600).seconds).toBe(0);
    expect(seekHover(2000, 1000, 3601).seconds).toBe(3600);
    expect(seekHover(2000, 1000, 3598).seconds).toBe(3598);
  });

  it("keeps the preview from hanging off the ends of the bar", () => {
    expect(seekHover(5, 1000, 3600).x).toBe(80);
    expect(seekHover(995, 1000, 3600).x).toBe(920);
    expect(seekHover(400, 1000, 3600).x).toBe(400);
  });

  it("copes with a bar narrower than the preview and one with no width", () => {
    expect(seekHover(10, 100, 600).x).toBe(50);
    expect(seekHover(10, 0, 600)).toEqual({ x: 0, seconds: 0 });
  });
});
