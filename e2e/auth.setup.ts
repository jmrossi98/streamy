import { test as setup, expect } from "@playwright/test";
import { E2E_USER, STORAGE_STATE } from "./fixtures";

/**
 * Signs in once and saves the cookie jar for every other spec to reuse.
 *
 * Driven through the real login form rather than by minting a JWT directly:
 * next-auth's credentials flow involves a CSRF round trip and a specific
 * cookie shape, and a hand-made token would keep passing if that flow broke.
 * This way the login path is itself covered by the fact that everything else
 * depends on it.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/name/i).fill(E2E_USER.name);
  await page.getByLabel(/password/i).fill(E2E_USER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Landing anywhere that isn't /login means the credentials were accepted.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
