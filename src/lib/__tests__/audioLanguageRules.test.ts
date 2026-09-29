import { describe, expect, it } from "vitest";
import { chooseAudio, defaultSubtitleIndex, isAllowedSubtitleLanguage, languageCodes, planAudio, type AudioTrack } from "../audioLanguageRules";

const dualAudioDubDefault: AudioTrack[] = [
  { index: 1, language: "eng", isDefault: true },
  { index: 2, language: "jpn", isDefault: false },
];

describe("planAudio", () => {
  it("picks the Japanese track on a dual-audio anime whose default is the dub, and says it needs a transcode", () => {
    const plan = planAudio(dualAudioDubDefault, "ja");
    expect(plan.track?.index).toBe(2);
    expect(plan.needsTranscode).toBe(true);
    expect(plan.hasOriginal).toBe(true);
  });

  it("needs no transcode when the original is already the default", () => {
    const plan = planAudio(
      [
        { index: 1, language: "jpn", isDefault: true },
        { index: 2, language: "eng", isDefault: false },
      ],
      "ja"
    );
    expect(plan.track?.index).toBe(1);
    expect(plan.needsTranscode).toBe(false);
  });

  it("treats the first track as default when none is flagged", () => {
    const plan = planAudio(
      [
        { index: 1, language: "eng", isDefault: false },
        { index: 2, language: "jpn", isDefault: false },
      ],
      "ja"
    );
    expect(plan.track?.index).toBe(2);
    expect(plan.needsTranscode).toBe(true);
  });

  it("falls back to the file default on a dub-only release", () => {
    const plan = planAudio([{ index: 1, language: "eng", isDefault: true }], "ja");
    expect(plan.track?.index).toBe(1);
    expect(plan.needsTranscode).toBe(false);
    expect(plan.hasOriginal).toBe(false);
  });

  it("does nothing special for an English title", () => {
    const plan = planAudio(
      [
        { index: 1, language: "eng", isDefault: true },
        { index: 2, language: "spa", isDefault: false },
      ],
      "en"
    );
    expect(plan.track?.index).toBe(1);
    expect(plan.needsTranscode).toBe(false);
  });

  it("matches both 639-2 forms", () => {
    expect(languageCodes("fr")).toEqual(["fr", "fre", "fra"]);
    const plan = planAudio(
      [
        { index: 1, language: "eng", isDefault: true },
        { index: 2, language: "fra", isDefault: false },
      ],
      "fr"
    );
    expect(plan.track?.index).toBe(2);
  });

  it("copes with no audio tracks or no language", () => {
    expect(planAudio([], "ja")).toEqual({ track: null, needsTranscode: false, hasOriginal: false });
    expect(planAudio(dualAudioDubDefault, null).needsTranscode).toBe(false);
  });
});

describe("defaultSubtitleIndex", () => {
  const subs = [
    { index: 3, language: "eng", label: "English - Signs & Songs" },
    { index: 4, language: "eng", label: "English" },
    { index: 5, language: "spa", label: "Spanish" },
  ];

  it("turns on full English subtitles under Japanese audio", () => {
    expect(defaultSubtitleIndex(subs, "jpn")).toBe(4);
  });

  it("leaves subtitles off under English audio", () => {
    expect(defaultSubtitleIndex(subs, "eng")).toBeNull();
  });

  it("leaves them off when the audio language is unknown", () => {
    expect(defaultSubtitleIndex(subs, null)).toBeNull();
  });

  it("falls back to a partial English track if that is all there is", () => {
    expect(defaultSubtitleIndex([subs[0], subs[2]], "jpn")).toBe(3);
  });

  it("returns null with no English subtitles", () => {
    expect(defaultSubtitleIndex([subs[2]], "jpn")).toBeNull();
    expect(defaultSubtitleIndex(null, "jpn")).toBeNull();
  });
});

describe("isAllowedSubtitleLanguage", () => {
  it("allows English, Spanish and untagged tracks only", () => {
    for (const l of ["eng", "en", "spa", "es", "ENG", null, "", "und"]) expect(isAllowedSubtitleLanguage(l)).toBe(true);
    for (const l of ["fre", "jpn", "deu", "por"]) expect(isAllowedSubtitleLanguage(l)).toBe(false);
  });
});

describe("chooseAudio", () => {
  const plan = { audioTracks: [{ index: 1 }, { index: 2 }], audioStreamIndex: 2 };
  it("honours a real track the viewer picked", () => {
    expect(chooseAudio(plan, "1")).toBe(1);
  });
  it("falls back to the plan for missing, bogus or unknown tracks", () => {
    expect(chooseAudio(plan, null)).toBe(2);
    expect(chooseAudio(plan, "abc")).toBe(2);
    expect(chooseAudio(plan, "7")).toBe(2);
  });
});
