import { test, expect } from "@playwright/test";

/**
 * Live TV's tab structure (2026-10-16): Now, Guide, Sports, Recordings, with
 * channel management moved to /admin/live-tv.
 *
 * Runs with no JELLYFIN_URL, so every tab shows its "not configured" state
 * rather than channels -- which is enough to assert the part that matters
 * here: the tabs are in the page, the URL picks the tab, and the management
 * controls that used to sit above the lineup are gone from the viewing page.
 */

test("Live TV opens on the Now tab with all four tabs in the page", async ({ page }) => {
  await page.goto("/live");
  const tabs = page.getByRole("navigation", { name: "Live TV sections" });
  await expect(tabs).toBeVisible({ timeout: 15_000 });
  for (const label of ["Now", "Guide", "Sports", "Recordings"]) {
    await expect(tabs.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(tabs.getByRole("link", { name: "Now" })).toHaveAttribute("aria-current", "page");

  // The management controls no longer live here.
  await expect(page.getByRole("button", { name: "Select" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hidden/ })).toHaveCount(0);
});

test("the URL picks the tab, and an unknown tab falls back to Now", async ({ page }) => {
  await page.goto("/live?tab=recordings");
  const tabs = page.getByRole("navigation", { name: "Live TV sections" });
  await expect(tabs.getByRole("link", { name: "Recordings" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Recordings will appear here once Sportarr has saved a game.")).toBeVisible();

  await page.goto("/live?tab=nonsense");
  await expect(tabs.getByRole("link", { name: "Now" })).toHaveAttribute("aria-current", "page");
});

test("clicking a tab changes the URL, and back returns to the previous tab", async ({ page }) => {
  await page.goto("/live");
  const tabs = page.getByRole("navigation", { name: "Live TV sections" });
  await tabs.getByRole("link", { name: "Guide" }).click();
  await expect(page).toHaveURL(/\/live\?tab=guide$/);
  await expect(tabs.getByRole("link", { name: "Guide" })).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/\/live$/);
  await expect(tabs.getByRole("link", { name: "Now" })).toHaveAttribute("aria-current", "page");
});

test("channel management is an admin page, not open to a viewer", async ({ page }) => {
  // The suite runs as an approved but NON-admin account (see fixtures.ts),
  // and the admin layout redirects anyone else to the home page.
  await page.goto("/admin/live-tv");
  await expect(page).not.toHaveURL(/\/admin\/live-tv/);
});
