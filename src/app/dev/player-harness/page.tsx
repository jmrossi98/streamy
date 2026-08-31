import { notFound } from "next/navigation";
import { PlayerHarness } from "./PlayerHarness";

/**
 * Mounts the real WatchPlayer/usePlayerEngine tree against a small bundled
 * test clip (public/test-assets/pause-test-clip.mp4), with no Radarr/Sonarr/
 * Jellyfin/DB dependency -- direct play only, so it's just a <video src>.
 * Exists solely so the Playwright suite (e2e/player.spec.ts) can click real
 * play/pause/seek controls and assert real <video> element state, which is
 * the only way anything catches a DOM-event race like the one that let a
 * pause click get silently undone once a deferred play() resolved (see
 * playIntentRef in usePlayerEngine.ts).
 *
 * 404s unless PLAYER_HARNESS_ENABLED=1 is set -- this is a test fixture, not
 * a feature, and streamy-app.com never sets it. Reachable without a session
 * (see middleware.ts's matcher) specifically so CI doesn't need a seeded
 * user/DB just to drive it; this env check is what actually keeps it out of
 * production, not the session gate.
 *
 * Deliberately NOT a NODE_ENV check: the Playwright suite (playwright.config.ts)
 * runs against a real production build (`next start`, not `next dev`) so
 * that React's dev-only StrictMode double-effect-invocation doesn't
 * introduce duplicate play()/pause() calls the app would never see for real
 * viewers -- confirmed live, that duplication was noisy enough to make a
 * deliberately-reverted fix look like it still passed. NODE_ENV is always
 * "production" in that build, so gating on it would 404 this route in the
 * very server the suite needs it reachable on.
 */
export default async function PlayerHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.PLAYER_HARNESS_ENABLED !== "1") notFound();

  const params = await searchParams;
  const progressSeconds = Number(params.progress ?? "0") || 0;
  const autoPlay = params.autoPlay === "1";

  return <PlayerHarness progressSeconds={progressSeconds} autoPlay={autoPlay} />;
}
