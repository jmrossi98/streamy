import { describe, expect, it } from "vitest";
import {
  holdTranscodeForResume,
  LATE_RESUME_WINDOW_SEC,
  pickResumeSeconds,
  RESUME_MOVED_SEC,
  shouldMoveStartedPlayback,
} from "../resumeStartRules";

describe("pickResumeSeconds", () => {
  it("takes a fresh answer that moved", () => {
    expect(pickResumeSeconds(852, 2460)).toBe(2460);
    // A prefetched page saying 0 for a title watched since.
    expect(pickResumeSeconds(0, 852)).toBe(852);
  });

  it("keeps the value in hand for the same spot, so nothing re-seeks", () => {
    expect(pickResumeSeconds(852, 852 + RESUME_MOVED_SEC)).toBe(852);
    expect(pickResumeSeconds(852, 850)).toBe(852);
  });

  it("keeps the value in hand when the question could not be asked", () => {
    expect(pickResumeSeconds(852, null)).toBe(852);
  });

  it("takes 0 as an answer -- nothing saved for this viewer", () => {
    expect(pickResumeSeconds(852, 0)).toBe(0);
  });
});

describe("holdTranscodeForResume", () => {
  it("holds a transcode until the resume point is settled", () => {
    expect(holdTranscodeForResume(true, false)).toBe(true);
    expect(holdTranscodeForResume(true, true)).toBe(false);
  });

  it("never holds direct play -- a seek there is a Range request, not a new encode", () => {
    expect(holdTranscodeForResume(false, false)).toBe(false);
    expect(holdTranscodeForResume(false, true)).toBe(false);
  });
});

describe("shouldMoveStartedPlayback", () => {
  it("does nothing before the start sequence has sought -- it reads the new value itself", () => {
    expect(shouldMoveStartedPlayback(null, 2460, 0)).toBe(false);
  });

  it("moves a playback that started from a stale spot and is still near it", () => {
    expect(shouldMoveStartedPlayback(852, 2460, 853)).toBe(true);
    expect(shouldMoveStartedPlayback(0, 852, 2)).toBe(true);
  });

  it("does not move for the same spot", () => {
    expect(shouldMoveStartedPlayback(852, 855, 860)).toBe(false);
  });

  it("does not move a viewer who has scrubbed away since", () => {
    expect(shouldMoveStartedPlayback(852, 2460, 852 + LATE_RESUME_WINDOW_SEC + 1)).toBe(false);
    expect(shouldMoveStartedPlayback(852, 2460, 100)).toBe(false);
  });
});
