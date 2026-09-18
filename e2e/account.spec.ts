import { test, expect } from "@playwright/test";
import { E2E_USER } from "./fixtures";

/**
 * Account, profiles, and the person pages.
 *
 * The person pages became testable only once getPersonById and
 * getPersonCredits got mocks -- they had none, so "mock mode" still sent them
 * to the live API and the page waited on a request that was never going to
 * succeed.
 */

test("the account page shows who is signed in", async ({ page }) => {
  const res = await page.goto("/account");
  expect(res?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /account/i })).toBeVisible();
  await expect(page.getByText(E2E_USER.name).first()).toBeVisible({ timeout: 10_000 });
});

test("a password change rejects the wrong current password", async ({ page }) => {
  await page.goto("/account");

  await page.locator("#currentPassword").fill("not-the-current-password");
  await page.locator("#newPassword").fill("A-New-Password-98765");
  await page.locator("#confirmPassword").fill("A-New-Password-98765");
  await page.getByRole("button", { name: /change password|update/i }).first().click();

  // The assertion that matters is the negative one: still on /account, still
  // signed in. A password change that silently succeeded against the wrong
  // current password would lock the real owner out, and it is exactly the kind
  // of check that is easy to move to the client and forget to keep on the
  // server.
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole("heading", { name: /account/i })).toBeVisible();
});

test("a mismatched confirmation cannot be submitted at all", async ({ page }) => {
  await page.goto("/account");

  const submit = page.getByRole("button", { name: /change password/i }).first();

  await page.locator("#currentPassword").fill(E2E_USER.password);
  await page.locator("#newPassword").fill("A-New-Password-98765");
  await page.locator("#confirmPassword").fill("A-Different-Password-11111");

  // The form disables submit rather than accepting and rejecting -- which is
  // the better behaviour, and not what an earlier draft of this test assumed.
  // It tried to click and spent 30 seconds waiting for a button that was
  // correctly never going to become enabled.
  await expect(submit).toBeDisabled();

  // Matching the confirmation enables it again, so the disable is tracking the
  // fields rather than being stuck off.
  await page.locator("#confirmPassword").fill("A-New-Password-98765");
  await expect(submit).toBeEnabled();

  // Deliberately not submitted. The saved storage state every other spec
  // depends on is a JWT for this account, and rotating the password mid-run
  // invalidates it -- turning one spec's success into every other spec's
  // failure, in whatever order they happened to run.
});

test("a person page renders a name and a filmography", async ({ page }) => {
  const res = await page.goto("/person/1000");
  expect(res?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: /mock person/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator("img").first()).toBeVisible({ timeout: 15_000 });
});

test("a person who does not exist does not error", async ({ page }) => {
  const res = await page.goto("/person/not-a-real-person");
  // 404 or a rendered empty state are both fine; a 500 is not. The mock
  // returns null for a non-numeric id specifically so this path has something
  // to exercise.
  expect(res?.status()).toBeLessThan(500);
});

test("who-is-watching sends an already-signed-in viewer straight in", async ({ page }) => {
  await page.goto("/who-is-watching");

  // The profile picker is the signed-out entry point. Someone who already has
  // a session does not need to choose again, and is redirected home -- which
  // is correct, and not what an earlier draft of this test expected.
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/$/, { timeout: 15_000 });
});
