import { test, expect } from "@playwright/test";

/**
 * Regression coverage for "clicking the pause button doesn't actually pause
 * the video" (reported live). Root cause: usePlayerEngine's `playing` state
 * only ever meant "has playback started without erroring" -- it was never
 * reset by a manual pause -- so a *deferred* play() call (waiting on a real
 * loadedmetadata event, from seekThenRun's resume-seek path) could fire
 * after the viewer had already paused and silently resume playback. Fixed
 * with playIntentRef, a real play/pause DOM-event-driven guard checked
 * immediately before that deferred play() call (see usePlayerEngine.ts).
 */

test("play then pause actually pauses, and stays paused", async ({ page }) => {
  await page.goto("/dev/player-harness");
  const video = page.locator("video");

  await page.getByRole("button", { name: /^play/i }).click();
  await expect(video).toHaveJSProperty("paused", false);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(video).toHaveJSProperty("paused", true);

  // The regression specifically undid the pause a moment later, once some
  // deferred event finally resolved -- a one-shot check right after the
  // click wouldn't have caught that. Hold here and confirm it's still
  // paused, not just paused-and-about-to-resume.
  await page.waitForTimeout(1500);
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 0);
});

test("a pause that lands while a resume is still loading is not overridden once loading finishes", async ({
  page,
}) => {
  // Holds the video response indefinitely (rather than a fixed delay) so
  // this test controls *exactly* when loadedmetadata fires -- a fixed delay
  // raced against goto()/hydration overhead and, depending on the machine,
  // sometimes resolved before the click below ever landed, exercising the
  // wrong code path and passing for the wrong reason. Registered before
  // goto() since the <video autoplay> attribute starts fetching the source
  // the instant the element mounts, well before any click.
  let releaseResponse!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/test-assets/pause-test-clip.mp4", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/dev/player-harness?progress=5", { waitUntil: "domcontentloaded" });
  const video = page.locator("video");

  // Establishes the real "already playing" precondition a native autoplay
  // success (or an earlier resume) would have left behind -- readyState is
  // still 0 (the response above is held), but HTMLMediaElement accepts
  // play() regardless and sets `paused` false immediately per spec. Without
  // some prior genuine paused=false, a pause() call below would be a no-op:
  // the browser only fires a real 'pause' event on an actual transition, and
  // there's nothing to transition from on an element that was never told to
  // play at all.
  await video.evaluate((v: HTMLVideoElement) => {
    v.play().catch(() => {});
  });
  await expect(video).toHaveJSProperty("paused", false);

  // Resume click: still held, so this schedules the deferred loadedmetadata
  // wait inside seekThenRun rather than resolving synchronously.
  await page.getByRole("button", { name: /^play/i }).click();

  // A real pause -- paused was false a moment ago, so this is a genuine
  // transition and fires the DOM 'pause' event playIntentRef listens for.
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await expect(video).toHaveJSProperty("paused", true);

  // Let the held response through -- loadedmetadata (and the deferred
  // resume it drives) fires now, well after the pause above.
  releaseResponse();
  await page.waitForTimeout(1500);
  await expect(video).toHaveJSProperty("paused", true);
});
