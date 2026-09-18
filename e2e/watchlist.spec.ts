import { test, expect } from "@playwright/test";
import { SEEDED_MOVIE_ID } from "./fixtures";

/**
 * Regression coverage for "button clicks aren't responding" (reported live).
 *
 * The buttons were not slow, they were absent. SessionProvider was mounted
 * without a session, so next-auth fetched /api/auth/session from the browser
 * on every page load and useSession() reported "loading" until it landed;
 * PosterWatchlistButton returns null unless status is "authenticated", so for
 * the whole of that round trip every My List button on the page was missing
 * from the DOM and a click where one was about to appear fell through to the
 * poster behind it. WatchlistProvider then made a second, serial round trip
 * for the saved-IDs, gated on that same status.
 *
 * The first test is the one that matters, and it deliberately does not use a
 * browser: it asserts against the raw server HTML. Anything driven through
 * page.goto() gives React time to hydrate and would have passed against the
 * broken build too -- the bug was a window, not a permanent state, and a test
 * that waits for the window to close cannot see it.
 */

test("My List buttons are in the server HTML, before any JavaScript runs", async ({
  request,
}) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  const html = await res.text();

  // Rendered server-side means present here. Under the bug this body carried
  // the posters but not one single watchlist control.
  expect(html).toContain("Add to My List");
});

test("saved state is resolved at render time, not fetched afterwards", async ({ request }) => {
  const res = await request.get("/");
  const html = await res.text();

  // The seeded title renders as "remove", which it can only do if the saved
  // IDs were known while the HTML was being built. Under the bug every button
  // began as "+" and corrected itself a round trip later.
  expect(html).toContain("Remove from My List");
});

test("My List lists the seeded title", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: /my list/i })).toBeVisible();
  await expect(page.locator(`a[href*="${SEEDED_MOVIE_ID}"]`).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("adding a title persists across a reload", async ({ page }) => {
  await page.goto("/");

  const add = page.getByRole("button", { name: "Add to My List" }).first();
  await expect(add).toBeVisible({ timeout: 15_000 });

  const before = await page.getByRole("button", { name: "Remove from My List" }).count();
  await add.click();

  // Greater-than rather than exactly one more: the mock catalogue deliberately
  // reuses the same twenty titles across trending and every genre row, so one
  // title being saved flips its button in several rows at once. Asserting +1
  // here would be asserting on how many rows the fixture happens to build.
  await expect
    .poll(() => page.getByRole("button", { name: "Remove from My List" }).count(), {
      timeout: 10_000,
    })
    .toBeGreaterThan(before);

  // And it persisted: a reload reads it back from the database, not from
  // client state a re-render would have thrown away.
  await page.reload();
  await expect
    .poll(() => page.getByRole("button", { name: "Remove from My List" }).count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
});

test("the button flips immediately, without waiting for the server", async ({ page }) => {
  // Hold the write open. Whatever the button does inside this window, it does
  // without any answer from the server.
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });

  await page.goto("/");
  const add = page.getByRole("button", { name: "Add to My List" }).first();
  await expect(add).toBeVisible({ timeout: 15_000 });

  const before = await page.getByRole("button", { name: "Remove from My List" }).count();
  await add.click();

  // The point of the change: this assertion has to pass while the POST above
  // is still hanging. Three of the five My List buttons used to wait for the
  // response before showing anything, which is what "I tapped it and nothing
  // happened" actually was -- and why one of them had already been rewritten
  // with a comment saying it "made adding a game feel broken enough to tap
  // twice". A short timeout is the assertion here, not impatience.
  await expect
    .poll(() => page.getByRole("button", { name: "Remove from My List" }).count(), {
      timeout: 2_000,
    })
    .toBeGreaterThan(before);

  release();
});
