import { expect, test } from "@playwright/test";

/**
 * Safari (and every iPhone browser) plays a transcode through its own HLS
 * player, and only the browser can say so -- the server has no navigator. On
 * 2026-11-13 a game recording that needed a transcode (an MKV) rendered on the
 * server with no <video src>, hydration never added one, and the iPhone sat on
 * a black screen without requesting a byte. The player now decides after
 * hydration, so the element gets its playlist.
 */
test("a transcode decided on the server gets its HLS source in Safari", async ({ page }) => {
  await page.goto("/dev/player-harness?transcode=1");
  await expect(page.locator("video").first()).toHaveAttribute("src", /\/hls\/master\.m3u8\?session=/);
});

test("direct play keeps its plain source in Safari", async ({ page }) => {
  await page.goto("/dev/player-harness");
  await expect(page.locator("video").first()).toHaveAttribute("src", "/test-assets/pause-test-clip.mp4");
});
