import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser tests for the video player's actual interactive behavior --
 * play/pause/seek against a genuine <video> element and hls.js, which is the
 * one thing the pure-logic vitest suite (vitest.config.ts) fundamentally
 * cannot exercise. Runs entirely against the /dev/player-harness fixture
 * (see src/app/dev/player-harness), so it needs no DB, no Radarr/Sonarr/
 * Jellyfin, and no seeded session -- just `next dev` serving the app.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // The real standalone production server (output: "standalone" in
    // next.config.mjs -- the same artifact the Docker image runs), not
    // `next dev`: React's dev-only StrictMode double-invokes effects, which
    // duplicated this suite's play()/pause() calls in ways the app never
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
    env: { PORT: "3100", PLAYER_HARNESS_ENABLED: "1" },
    url: "http://127.0.0.1:3100/dev/player-harness",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
