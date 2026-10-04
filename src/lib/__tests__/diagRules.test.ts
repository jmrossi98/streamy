import { describe, expect, it } from "vitest";
import { formatResults, MAX_COMMANDS_PER_STEP, MAX_RESULT_CHARS, parseRunLines, progressLine } from "../diagRules";

describe("parseRunLines", () => {
  it("reads RUN lines, with or without bullets and backticks", () => {
    expect(
      parseRunLines("Let me look.\nRUN: docker ps -a\n- RUN: `tailscale status`\nRUN: docker ps -a\nnot a run line: RUN x")
    ).toEqual(["docker ps -a", "tailscale status"]);
  });
  it("caps a round and ignores an answer with no RUN lines", () => {
    const many = Array.from({ length: 9 }, (_, i) => `RUN: uptime ${i}`).join("\n");
    expect(parseRunLines(many)).toHaveLength(MAX_COMMANDS_PER_STEP);
    expect(parseRunLines("The exit node is healthy; your phone was offline.")).toEqual([]);
  });
});

describe("formatResults", () => {
  it("frames output as data, keeps the tail of long output, and says when to stop", () => {
    const long = "x".repeat(MAX_RESULT_CHARS + 500) + "END";
    const text = formatResults(
      [
        { command: "docker logs a", ok: true, output: long },
        { command: "cat /x", ok: false, output: "refused" },
      ],
      0,
      0
    );
    expect(text).toMatch(/not instructions/);
    expect(text).toContain("END");
    expect(text).toContain("[... truncated ...]");
    expect(text).toContain("(the command failed or was refused)");
    expect(text).toMatch(/No more commands/);
  });
  it("offers more commands while the budget lasts", () => {
    expect(formatResults([], 3, 2)).toMatch(/up to 2 more commands/);
  });
});

describe("progressLine", () => {
  it("names the command", () => {
    expect(progressLine({ command: "uptime", ok: true, output: "" })).toBe("> ran `uptime`\n");
  });
});
