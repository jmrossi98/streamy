import { describe, it, expect } from "vitest";
import { isSafeFlashFileName } from "../flashLibrary";

/**
 * A literal backslash, built rather than typed.
 *
 * Written inline as "sub\dir\game.swf" it is an escape sequence, and JS
 * reads it as "subdirgame.swf" -- a perfectly safe filename. The test passed
 * while asserting nothing about Windows-style traversal.
 */
const BACKSLASH = String.fromCharCode(92);

describe("isSafeFlashFileName", () => {
  // The name reaches the proxy from a database row, but that row can be
  // written from a Flashpoint title, so it is not automatically trustworthy.
  // A traversal here would turn the proxy into a reader of anything nginx can
  // see -- hence a whitelist of what a real filename looks like rather than a
  // blacklist of what an attack looks like.
  it("rejects path traversal in every shape", () => {
    for (const name of [
      "../../../etc/passwd",
      "..%2f..%2fetc%2fpasswd.swf",
      "sub/dir/game.swf",
      `sub${BACKSLASH}dir${BACKSLASH}game.swf`,
      "..",
      "../game.swf",
      "game/../../../secret.swf",
    ]) {
      expect(isSafeFlashFileName(name)).toBe(false);
    }
  });

  it("rejects anything that isn't a .swf", () => {
    for (const name of ["nginx.conf", "game.exe", "game.swf.txt", "game", "game.php"]) {
      expect(isSafeFlashFileName(name)).toBe(false);
    }
  });

  it("rejects dotfiles and empty or absurd names", () => {
    expect(isSafeFlashFileName(".hidden.swf")).toBe(false);
    expect(isSafeFlashFileName("")).toBe(false);
    expect(isSafeFlashFileName("a".repeat(300) + ".swf")).toBe(false);
  });

  // Real Flash filenames are messy: spaces, brackets, apostrophes and dashes
  // are all normal, and rejecting them would rule out most of the archive.
  it("accepts the filenames real games actually have", () => {
    for (const name of [
      "thegamegame.swf",
      "The Game Game.swf",
      "Mario Destroyer.swf",
      "Bloons Tower Defense 5 (v1.2).swf",
      "Alien Hominid [Newgrounds].swf",
      "Bob's Adventure.swf",
      "super-mario-63.swf",
      "GAME.SWF",
    ]) {
      expect(isSafeFlashFileName(name)).toBe(true);
    }
  });
});
