import { describe, it, expect } from "vitest";
import { containerBlocksDirectPlay, isChromium } from "../directPlayRules";

// The real User-Agents from 2026-10-15's access log, plus the usual suspects.
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0";

describe("containerBlocksDirectPlay", () => {
  it("sends Safari straight to the transcode for an .mkv (the 2026-10-15 case)", () => {
    expect(containerBlocksDirectPlay("mkv", SAFARI_MAC)).toBe(true);
  });

  it("does the same for every iOS browser, including iOS Chrome, and for Firefox", () => {
    expect(containerBlocksDirectPlay("mkv", CHROME_IOS)).toBe(true);
    expect(containerBlocksDirectPlay("mkv", FIREFOX)).toBe(true);
  });

  it("lets Chromium direct-play Matroska", () => {
    expect(containerBlocksDirectPlay("mkv", CHROME_WIN)).toBe(false);
    expect(containerBlocksDirectPlay("mkv", EDGE)).toBe(false);
    expect(isChromium(CHROME_IOS)).toBe(false);
  });

  it("lets everyone direct-play MP4, including Jellyfin's comma-list form", () => {
    expect(containerBlocksDirectPlay("mp4", SAFARI_MAC)).toBe(false);
    expect(containerBlocksDirectPlay("mov,mp4,m4a,3gp,3g2,mj2", SAFARI_MAC)).toBe(false);
  });

  it("transcodes AVI even for Chromium", () => {
    expect(containerBlocksDirectPlay("avi", CHROME_WIN)).toBe(true);
  });

  it("keeps the old behaviour when it does not know", () => {
    expect(containerBlocksDirectPlay(null, SAFARI_MAC)).toBe(false);
    expect(containerBlocksDirectPlay("mkv", null)).toBe(false);
    expect(containerBlocksDirectPlay("", SAFARI_MAC)).toBe(false);
  });
});
