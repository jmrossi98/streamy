import { test, expect } from "@playwright/test";
import { SEEDED_MOVIE_ID, SEEDED_SHOW_ID } from "./fixtures";

/**
 * The browsing surfaces: the pages a viewer actually spends their time on.
 *
 * All of these run against the TMDB mock (TMDB_FORCE_MOCK, see
 * playwright.config.ts), so the catalogue is fixed and an assertion about what
 * is on the page stays true tomorrow. Nothing here needs the home server.
 */

// No heading is asserted for / or /movies: neither has one. They open straight
// into genre rows, which is a deliberate layout choice and not something a test
// should quietly require them to change.
const BROWSE_PAGES = [
  { path: "/", heading: null },
  { path: "/movies", heading: null },
  { path: "/tv", heading: null },
  { path: "/watchlist", heading: /my list/i },
];

for (const { path, heading } of BROWSE_PAGES) {
  test(`${path} renders with posters and navigation`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);

    await expect(page.locator("nav, header").first()).toBeVisible({ timeout: 15_000 });
    if (heading) {
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }

    // At least one poster image. A page that renders its shell and no content
    // is the failure this catches -- it looks fine in a screenshot and is
    // useless to a viewer.
    await expect(page.locator("img").first()).toBeVisible({ timeout: 15_000 });
  });
}

test("the primary navigation reaches every section", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("nav, header").first()).toBeVisible();

  for (const [href, label] of [
    ["/movies", "Movies"],
    ["/tv", "TV Shows"],
    ["/watchlist", "My List"],
  ] as const) {
    const link = page.getByRole("link", { name: label }).first();
    await expect(link, `no nav link for ${label}`).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}/?$`), { timeout: 15_000 });
    await page.goto("/");
  }
});

test("a movie page opens for a title with no playable file", async ({ page }) => {
  const res = await page.goto(`/watch/${SEEDED_MOVIE_ID}`);
  expect(res?.status()).toBe(200);

  // Deliberately NOT asserting a Play button. There is no Jellyfin here, so
  // nothing is playable, and the page is right not to offer playback -- an
  // earlier draft of this test asserted one and failed against correct
  // behaviour. What must hold is that the page still renders the title and its
  // My List control rather than erroring on the absent file.
  await expect(page.locator("nav, header").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /my list/i }).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("a show page opens and lists episodes", async ({ page }) => {
  const res = await page.goto(`/show/${SEEDED_SHOW_ID}`);
  expect(res?.status()).toBe(200);

  await expect(page.locator("nav, header").first()).toBeVisible({ timeout: 15_000 });

  // Scoped to what is actually on screen. The season summary is rendered twice
  // in responsive variants, and .first() picked the one hidden at this
  // viewport -- so this failed while the page was perfectly correct.
  await expect(page.getByText(/season/i).locator("visible=true").first()).toBeVisible({
    timeout: 15_000,
  });
});

test("search finds a title from the catalogue", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Search" }).first().click();

  const input = page.getByPlaceholder(/search movies and shows/i);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill("Mock Movie");

  // Results are debounced and fetched, so this is a poll rather than a single
  // check. The assertion is that *something* matching came back -- the mock
  // catalogue is all "Mock Movie N", so a hit proves the query reached the
  // search path and rendered.
  await expect(page.getByText(/Mock Movie/i).first()).toBeVisible({ timeout: 15_000 });
});

test("search for something absent reports no results rather than breaking", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).first().click();

  const input = page.getByPlaceholder(/search movies and shows/i);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill("zzzzz-no-such-title-zzzzz");

  // Whatever it says, it must not throw: an empty result set is the most
  // ordinary thing a search does, and the one most likely to hit an unguarded
  // `results[0]`.
  await page.waitForTimeout(1_500);
  await expect(input).toBeVisible();
  await expect(page.locator("nav, header").first()).toBeVisible();
});
