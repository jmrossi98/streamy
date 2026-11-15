import { describe, it, expect } from "vitest";
import { cleanSubtitleText } from "../subtitleTextRules";

const vtt = (...cues: string[]) =>
  ["WEBVTT", "", ...cues.flatMap((c, i) => [`00:00:0${i}.000 --> 00:00:0${i}.900`, c, ""])].join("\n");

describe("subtitle text from ASS", () => {
  it("turns Cowboy Bebop's italics into WebVTT italics", () => {
    expect(cleanSubtitleText(vtt("{\\i1}brings you information about fugitives!{\\i0}"))).toBe(
      vtt("<i>brings you information about fugitives!</i>")
    );
  });

  it("drops position, fade and colour codes, keeping the words", () => {
    expect(cleanSubtitleText(vtt("{\\an8\\fad(200,200)\\c&H00FFFF&}Top of the screen"))).toBe(vtt("Top of the screen"));
  });

  it("keeps the toggles a mixed block carries, in order", () => {
    expect(cleanSubtitleText(vtt("{\\fad(100,100)\\i1}Hi{\\i0} there {\\b1}you{\\b0}"))).toBe(vtt("<i>Hi</i> there <b>you</b>"));
  });

  it("does not read \\i10 or \\bord2 as italic or bold", () => {
    expect(cleanSubtitleText(vtt("{\\bord2\\blur10}Outlined"))).toBe(vtt("Outlined"));
  });

  it("makes ASS line breaks real ones without leaving an empty line in the cue", () => {
    expect(cleanSubtitleText(vtt("- Spike!\\N- What?"))).toBe(vtt("- Spike!\n- What?"));
    expect(cleanSubtitleText(vtt("One\\N\\NTwo"))).toBe(vtt("One\nTwo"));
    expect(cleanSubtitleText(vtt("Hard\\hspace"))).toBe(vtt("Hard space"));
  });

  it("drops a line that held only codes, so the cue keeps its other line", () => {
    expect(cleanSubtitleText(vtt("{\\an8}\nStill here"))).toBe(vtt("Still here"));
  });

  it("drops vector drawings, which are not words", () => {
    expect(cleanSubtitleText(vtt("{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}Sign text"))).toBe(vtt("Sign text"));
    expect(cleanSubtitleText(vtt("Caption\n{\\an7\\p1}m 0 0 l 10 0"))).toBe(vtt("Caption"));
  });

  it("leaves subtitles without ASS codes exactly as they were", () => {
    const plain = vtt("<i>Already WebVTT</i>", "- Two\n- Lines");
    expect(cleanSubtitleText(plain)).toBe(plain);
    const braces = vtt("{laughs} No backslash, not a code");
    expect(cleanSubtitleText(braces)).toBe(braces);
  });

  it("keeps the header, timings and gaps between cues", () => {
    const doc = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n{\\i1}a{\\i0}\n\n2\n00:00:03.000 --> 00:00:04.000\nb\n";
    expect(cleanSubtitleText(doc)).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<i>a</i>\n\n2\n00:00:03.000 --> 00:00:04.000\nb\n");
  });
});
