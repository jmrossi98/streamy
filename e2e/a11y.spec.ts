import { test, expect } from "@playwright/test";

/**
 * The interface behaving consistently for people who are not using a mouse.
 *
 * Asserted rather than eyeballed because both rules live in one global
 * stylesheet and apply by construction: a new component gets them for free,
 * and a component that opts out -- Tailwind's `outline-none`, which 25 places
 * were using -- is overridden on specificity. That holds only until somebody
 * raises theirs, and nothing else in the suite would notice if they did.
 *
 * Everything here runs against "/" rather than "/login". These specs run
 * signed in (see playwright.config.ts), so /login redirects out from under
 * them -- which first showed up as "Execution context was destroyed, most
 * likely because of a navigation" in the middle of an evaluate.
 */

test("tabbing to a control paints a visible ring", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // A real Tab, not element.focus(). Programmatic focus does not reliably
  // satisfy :focus-visible, so a test built on it can fail while the app is
  // correct -- the wrong way round for a regression test.
  await page.keyboard.press("Tab");

  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      focusVisible: el.matches(":focus-visible"),
      width: parseFloat(s.outlineWidth),
      style: s.outlineStyle,
      color: s.outlineColor,
    };
  });

  expect(outline, "nothing took focus on Tab").not.toBeNull();
  expect(outline!.focusVisible).toBe(true);

  // The failure this catches is `outline: 2px solid transparent` -- Tailwind's
  // `outline-none`, which looks like an outline to anything checking only
  // width, and is invisible.
  expect(outline!.style).toBe("solid");
  expect(outline!.width).toBeGreaterThanOrEqual(2);
  expect(outline!.color).not.toBe("rgba(0, 0, 0, 0)");
});

test("every control reached by tabbing has a visible ring, not just the first", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        visible: s.outlineStyle === "solid" && parseFloat(s.outlineWidth) >= 2,
      };
    });
    if (!result) continue;
    if (!result.visible) seen.push(`${i}:${result.tag}`);
  }

  // One control quietly opting out is exactly the regression this guards: the
  // global rule wins on specificity today, and a component that raises its own
  // would silently go dark for keyboard users while everything still looked
  // fine to whoever wrote it.
  expect(seen, `controls without a visible focus ring: ${seen.join(", ")}`).toEqual([]);
});

test("reduced motion collapses transitions but leaves the spinner spinning", async ({
  page,
}) => {
  // Set explicitly rather than via test.use({ reducedMotion }) in a describe --
  // that was silently not applying (matchMedia reported false while the rule
  // was present in the stylesheet), so the test failed against working CSS.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  expect(
    await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    "emulation did not take"
  ).toBe(true);

  const transitionMs = await page.evaluate(() => {
    const el = document.createElement("div");
    el.style.transitionDuration = "500ms";
    document.body.appendChild(el);
    const d = getComputedStyle(el).transitionDuration;
    el.remove();
    return d;
  });
  expect(parseFloat(transitionMs)).toBeLessThan(0.05);

  // A frozen spinner turns "still loading" into "this is broken", so it is
  // deliberately exempt. Without the carve-out the blanket rule sets
  // animation-iteration-count: 1 and it stops after one rotation.
  const spinner = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "animate-spin";
    document.body.appendChild(el);
    const s = getComputedStyle(el);
    const out = { duration: s.animationDuration, iterations: s.animationIterationCount };
    el.remove();
    return out;
  });
  expect(spinner.iterations).toBe("infinite");
  expect(parseFloat(spinner.duration)).toBeGreaterThan(0.1);
});
