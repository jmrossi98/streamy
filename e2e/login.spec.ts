import { test, expect } from "@playwright/test";
import { E2E_UNAPPROVED, E2E_USER } from "./fixtures";

/**
 * Runs in the "anon" project (see playwright.config.ts) -- these must start
 * signed out, so they deliberately do not inherit the saved storage state.
 */

test("an approved account can sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/name/i).fill(E2E_USER.name);
  await page.getByLabel(/password/i).fill(E2E_USER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
});

test("a wrong password is rejected and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/name/i).fill(E2E_USER.name);
  await page.getByLabel(/password/i).fill("definitely-not-the-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("an unapproved account cannot get in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/name/i).fill(E2E_UNAPPROVED.name);
  await page.getByLabel(/password/i).fill(E2E_UNAPPROVED.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Approval is enforced at sign-in, not merely hidden in the UI.
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("a signed-out visitor cannot reach the app", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});

test("removing a Live TV channel refuses an anonymous caller", async ({ request }) => {
  // Lives here rather than in resilience.spec.ts because this is the only
  // project that runs signed out -- that spec carries a session, so the
  // assertion would have passed without ever being anonymous.
  //
  // Removing a channel is open to any signed-in viewer as of 2026-09-27, which
  // makes the remaining boundary worth guarding exactly this one: a stranger
  // must not be able to take a channel out of everyone's lineup.
  const res = await request.post("/api/live/streams/demote", {
    data: { channelId: 1 },
  });
  expect(res.status()).toBe(403);
});
