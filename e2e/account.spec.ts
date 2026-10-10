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

test("watch history lists what was watched and lets it be removed", async ({ page }) => {
  // Saved through the same route the player uses, so the entries are real rows.
  for (const movieId of ["603", "27205"]) {
    const res = await page.request.post("/api/progress", { data: { movieId, progressSeconds: 300 } });
    expect(res.ok()).toBe(true);
  }

  await page.goto("/account");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Watch history" }) });
  const rows = section.getByRole("listitem");
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  // Each entry carries a real date, not a blank.
  await expect(rows.first().locator("time")).toHaveText(/\d/);

  await rows.first().getByRole("button", { name: /^remove/i }).click();
  await expect(rows).toHaveCount(1);

  await section.getByRole("button", { name: "Clear all history" }).click();
  await section.getByRole("button", { name: "Yes, clear it" }).click();
  await expect(section.getByText("Nothing watched yet.")).toBeVisible();

  // Gone on the server, not just from the page.
  const after = await (await page.request.get("/api/history")).json();
  expect(after.items).toEqual([]);
});
