import { notFound } from "next/navigation";
import { EpisodeHarness } from "./EpisodeHarness";

/**
 * The real EpisodePlayer against the bundled 4-second test clip, for
 * e2e/player.spec.ts to drive skipping the intro and rolling on to the next
 * episode in fullscreen. Same rules as /dev/player-harness (see its page):
 * 404s unless PLAYER_HARNESS_ENABLED=1, reachable without a session. The
 * next episode's playback is answered by the test itself (page.route).
 */
export default function EpisodeHarnessPage() {
  if (process.env.PLAYER_HARNESS_ENABLED !== "1") notFound();
  return <EpisodeHarness />;
}
