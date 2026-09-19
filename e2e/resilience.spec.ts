import { test, expect } from "@playwright/test";

/**
 * What the app does when the things it depends on are not there.
 *
 * The suite runs with no JELLYFIN_URL, no Sonarr, no Radarr and no gamarr --
 * which is not a limitation to work around here, it is the exact condition
 * worth asserting. A home server that is rebooting, mid-VPN-recreate or simply
 * off looks identical to this from Streamy's side, and it is the normal state
 * of this app several times a week.
 *
 * The bar is that a section being unavailable stays a *section* being
 * unavailable: a page that says so, with the rest of the site still working.
 * Not a 500, and not the root error boundary taking the whole app down with
 * developer text about `docker logs` and RUN_MIGRATE aimed at whoever happened
 * to be watching.
 */

const DEGRADABLE_ROUTES = [
  { path: "/live", name: "Live TV" },
  { path: "/games", name: "Games" },
];

for (const { path, name } of DEGRADABLE_ROUTES) {
  test(`${name} degrades instead of erroring when its backend is absent`, async ({
    page,
  }) => {
    const response = await page.goto(path);

    // A 5xx here means the failure reached the server as an unhandled throw.
    expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(500);

    // The shell survives: whatever happened to the section, the viewer can
    // still get somewhere else. This is the part a root-level error boundary
    // would fail -- it replaces the entire document, navbar included.
    await expect(page.locator("nav, header").first()).toBeVisible({ timeout: 15_000 });
  });
}

test("a route that does not exist is a 404, not a server error", async ({ page }) => {
  const response = await page.goto("/definitely-not-a-real-route");
  expect(response?.status()).toBe(404);
});

test("the health endpoint answers for anonymous callers", async ({ request }) => {
  // The container healthcheck calls exactly this, and autoheal restarts the
  // app when it fails. If it ever required a session, every deploy would
  // restart-loop itself: unauthenticated probe, 401, "unhealthy", kill, repeat.
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
});

test("the stream browser API is closed to non-admins", async ({ request }) => {
  // The suite runs as an approved but NON-admin account (see fixtures.ts), so
  // this asserts the gate rather than the happy path.
  //
  // Worth its own test because the two endpoints differ in blast radius from
  // everything else in this app: the first reads the provider's entire
  // catalogue, and the second publishes a channel to every viewer. A
  // regression that dropped the admin check would not be visible in the UI at
  // all, since the panel is hidden from non-admins by a separate condition.
  const list = await request.get("/api/live/streams");
  expect(list.status()).toBe(403);

  const promote = await request.post("/api/live/streams/promote", {
    data: { streamId: 1, name: "should not work" },
  });
  expect(promote.status()).toBe(403);
});
