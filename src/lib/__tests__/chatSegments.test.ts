import { describe, it, expect } from "vitest";
import { splitMessage, copyableText, type Segment } from "../chatSegments";

const F = "```";
const code = (s: Segment[]) => s.filter((x) => x.kind === "code");
const text = (s: Segment[]) => s.filter((x) => x.kind === "text");

describe("splitMessage", () => {
  it("leaves a plain answer as one text segment", () => {
    const s = splitMessage("Radarr is up, nothing to do.");
    expect(s).toEqual([{ kind: "text", text: "Radarr is up, nothing to do." }]);
  });

  it("pulls out a fenced block with its language", () => {
    const s = splitMessage(`Run this:\n${F}sh\ndocker restart radarr\n${F}\nthen check.`);
    expect(code(s)).toEqual([
      { kind: "code", text: "docker restart radarr\n", lang: "sh", open: false },
    ]);
    expect(text(s).map((t) => t.text)).toEqual(["Run this:\n", "then check."]);
  });

  it("handles a fence with no language", () => {
    const s = splitMessage(`${F}\nls -l\n${F}`);
    expect(code(s)[0]).toMatchObject({ lang: "", open: false, text: "ls -l\n" });
  });

  it("marks an unclosed block open, as happens mid-stream", () => {
    // Most of a code block's life is spent without its closing fence, because
    // answers arrive token by token. Treating that as prose would make the
    // text visibly reflow the moment the block completed.
    const s = splitMessage(`Try:\n${F}sh\ndocker resta`);
    expect(code(s)[0]).toMatchObject({ open: true, text: "docker resta" });
  });

  it("keeps several blocks separate", () => {
    const s = splitMessage(`one\n${F}\na\n${F}\ntwo\n${F}\nb\n${F}\nthree`);
    expect(code(s).map((c) => c.text)).toEqual(["a\n", "b\n"]);
    expect(text(s).map((t) => t.text)).toEqual(["one\n", "two\n", "three"]);
  });

  it("does not open a block on backticks mid-sentence", () => {
    // The model quoting a fence while explaining markdown must not swallow
    // the rest of the answer into a code block.
    const s = splitMessage("use ``` to fence code");
    expect(code(s)).toEqual([]);
  });

  it("preserves blank lines inside a block", () => {
    const s = splitMessage(`${F}\na\n\nb\n${F}`);
    expect(code(s)[0].text).toBe("a\n\nb\n");
  });

  it("returns nothing for an empty message", () => {
    expect(splitMessage("")).toEqual([]);
  });
});

describe("copyableText", () => {
  it("strips the trailing newline so a paste does not self-execute", () => {
    // The whole safety margin between a suggested command and a run one is
    // that the paste lands on the prompt and waits.
    expect(copyableText("docker restart radarr\n")).toBe("docker restart radarr");
  });

  it("strips shell prompts models habitually emit", () => {
    expect(copyableText("$ docker ps\n")).toBe("docker ps");
    expect(copyableText("# systemctl status\n")).toBe("systemctl status");
  });

  it("keeps a multi-line script intact", () => {
    expect(copyableText("cd /srv\ndocker compose up -d\n")).toBe(
      "cd /srv\ndocker compose up -d"
    );
  });

  it("does not eat a # that is a comment rather than a prompt", () => {
    // "#comment" has no space after the hash; a root prompt does.
    expect(copyableText("#!/bin/sh\necho hi")).toBe("#!/bin/sh\necho hi");
  });

  it("leaves an inner blank line alone", () => {
    expect(copyableText("a\n\nb\n\n")).toBe("a\n\nb");
  });
});
