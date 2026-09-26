import { test, expect } from "@playwright/test";

/**
 * Waits until React has actually attached handlers to a control.
 *
 * Playwright's click waits for an element to be visible, stable and enabled --
 * none of which say anything about whether a handler is bound. Server-rendered
 * HTML produces a button that satisfies all three while doing nothing at all,
 * so a click during that window is swallowed and the test goes on to assert
 * against a state nothing ever moved it to.
 *
 * That is not hypothetical here: it is the same shape as the bug this app was
 * just fixed for (My List buttons absent until a session round trip resolved),
 * and it showed up as this file failing only under full-suite CPU contention,
 * reporting currentTime 0 -- the deferred resume never armed because the click
 * that arms it did nothing.
 *
 * React sets __reactFiber$/__reactProps$ expandos on a DOM node when it
 * hydrates it. Reaching for an internal is justified by the alternative: the
 * usual substitute is a sleep, which is the same bet with worse odds.
 */
async function clickWhenHydrated(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator
) {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate((el) =>
    new Promise<void>((resolve) => {
      const hydrated = () => Object.keys(el).some((k) => k.startsWith("__react"));
      if (hydrated()) return resolve();
      const started = Date.now();
      const tick = () => {
        if (hydrated() || Date.now() - started > 10_000) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    })
  );
  await locator.click();
}

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

  await clickWhenHydrated(page, page.getByRole("button", { name: /^play/i }).first());
  await expect(video).toHaveJSProperty("paused", false);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(video).toHaveJSProperty("paused", true);

  // The regression specifically undid the pause a moment later, once some
  // deferred event finally resolved -- a one-shot check right after the
  // click wouldn't have caught that. Hold here and confirm it's still
  // paused, not just paused-and-about-to-resume.
  //
  // The playhead is compared against where it actually stopped, not against
  // zero. play() legitimately advances a few milliseconds before the pause
  // lands -- CI measured 0.002s -- and asserting an exact 0 failed on that
  // artifact rather than on the regression. "Did not move while paused" is
  // both the thing this test is for and impossible to flake.
  const stoppedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(1500);
  await expect(video).toHaveJSProperty("paused", true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(stoppedAt);
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

  // Resume click FIRST, before anything has played. This ordering is the whole
  // reason the test is stable.
  //
  // It used to call video.play() up here to establish a "already playing"
  // precondition, then look for this control -- and those two things cannot
  // both be true for long. VideoChrome renders
  // aria-label={isPlaying ? "Pause" : "Play"} (VideoChrome.tsx:138) and
  // unmounts the centre overlay Play button once playing, so the moment React
  // processed the resulting 'play' event nothing on the page matched /^play/i
  // and the click waited out its timeout. Whether it won came down to whether
  // the machine reached React first: it passed alone for months and began
  // failing the moment other specs competed for CPU beside it.
  //
  // The harness does not autoplay (autoPlay is opt-in via ?autoPlay=1, see
  // page.tsx), so at this point the video is genuinely paused, React agrees,
  // and this control is unambiguously a resume. The response is still held, so
  // the click schedules the deferred loadedmetadata wait inside seekThenRun
  // rather than resolving synchronously -- which is the state under test.
  await clickWhenHydrated(page, page.getByRole("button", { name: /^play/i }).first());

  // Now establish a real playing -> paused transition, which is what
  // playIntentRef actually listens for. readyState is still 0, but
  // HTMLMediaElement accepts play() regardless and sets `paused` false
  // immediately per spec. Without a genuine paused=false first, the pause()
  // below would be a no-op: the browser only fires a real 'pause' event on an
  // actual transition.
  await video.evaluate((v: HTMLVideoElement) => {
    v.play().catch(() => {});
  });
  await expect(video).toHaveJSProperty("paused", false);

  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await expect(video).toHaveJSProperty("paused", true);

  // Let the held response through -- loadedmetadata (and the deferred
  // resume it drives) fires now, well after the pause above.
  releaseResponse();
  await page.waitForTimeout(1500);

  // The seek half of the deferred resume DID run: ?progress=5 moved the
  // playhead off zero once metadata arrived.
  //
  // This assertion is here to stop the test passing for the wrong reason. Every
  // other check below is a negative -- "it did not start playing" -- and a
  // negative is satisfied just as well by a deferred resume that never fired at
  // all, which is precisely what a future refactor is most likely to break.
  // Seeing the seek land proves the path under test executed, so the paused
  // assertion that follows is about the guard rather than about nothing having
  // happened.
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 5_000 })
    .toBeGreaterThan(1);

  // ...and the play half did not, because the viewer had paused in the
  // meantime. This is the regression: playIntentRef in usePlayerEngine.ts.
  await expect(video).toHaveJSProperty("paused", true);
});
