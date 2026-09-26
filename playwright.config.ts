import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE, TEST_DATABASE_URL } from "./e2e/fixtures";

/**
 * Real-browser coverage for behavior the pure-logic vitest suite
 * (vitest.config.ts) fundamentally cannot reach: whether a control is actually
 * in the page, whether clicking it does the thing, and whether a feature still
 * works end to end through its own API routes and database.
 *
 * Everything external is stubbed. TMDB_FORCE_MOCK routes lib/tmdb.ts at
 * lib/tmdb-mock.ts (see the FORCE_MOCK comment there), and DATABASE_URL points
 * at a throwaway SQLite file that global-setup.ts rebuilds and seeds on every
 * run. So the suite needs no API key, no Radarr/Sonarr/Jellyfin, and no
 * network -- and it asserts the same answer every time, which is the only way
 * a failure can be read as "a feature broke" rather than "TMDB re-ranked what
 * is trending".
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Capped deliberately. player.spec.ts asserts on real-time <video> behavior --
  // whether a deferred play() fires after a pause -- and those assertions are
  // only meaningful if the machine is actually keeping up. Left at Playwright's
  // default the browsers compete with the Next server for CPU and that spec
  // fails on timing while passing every time it is run alone, which is the
  // worst kind of test: one that reports load, not correctness.
  workers: process.env.CI ? 2 : 3,
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },

  projects: [
    // Signs in once; every authenticated project below reuses the cookie jar
    // it saves rather than re-driving the login form per spec file.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Specs about signing in, which must start signed *out*.
    {
      name: "anon",
      testMatch: /(login|auth)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
    },
    // Everything else, already signed in.
    {
      name: "chromium",
      testIgnore: /(login|auth)\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
    },
  ],

  webServer: {
    // The real standalone production server (output: "standalone" in
    // next.config.mjs -- the same artifact the Docker image runs), not
    // `next dev`: React's dev-only StrictMode double-invokes effects, which
    // duplicated the player suite's play()/pause() calls in ways the app never
    // produces for a real viewer and made a deliberately-reverted fix look
    // like it still passed. Needs `npm run build:e2e` to have already run
    // (builds, then copies public/ and .next/static into the standalone
    // output -- next build doesn't do that itself; see package.json). CI
    // runs that as its own step so this can stay a fixed command rather
    // than eating a rebuild on every local run too.
    command: "node .next/standalone/server.js",
    // Native webServer.env, not a shell `cross-env` prefix in the command
    // string above -- confirmed live that cross-env's child process didn't
    // reliably pass PLAYER_HARNESS_ENABLED through in this environment (the
    // server came up fine but 404'd the harness route every time), while
    // running the same command directly with the vars set on this process
    // worked immediately.
    env: {
      PORT: "3100",
      PLAYER_HARNESS_ENABLED: "1",
      TMDB_FORCE_MOCK: "1",
      // Never used -- TMDB_FORCE_MOCK routes every lookup at tmdb-mock.ts.
      // Present because /api/health treats a missing key as "not ok", and
      // the container healthcheck calls that endpoint: resilience.spec.ts
      // asserts it answers, and without a key it answered 503 in CI while
      // passing locally off a populated .env.
      TMDB_API_KEY: "e2e-mock-key",
      DATABASE_URL: TEST_DATABASE_URL,
      // Fixed rather than generated: the storage state saved by auth.setup.ts
      // is a JWT signed with this, and a fresh secret per run would invalidate
      // it the moment the server restarted mid-suite.
      NEXTAUTH_SECRET: "e2e-not-a-real-secret-do-not-use-outside-tests",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
      AUTH_TRUST_HOST: "true",
      // The startup migration belongs to global-setup.ts, which has already
      // run against this exact file by the time the server boots.
      RUN_MIGRATE: "0",
    },
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
