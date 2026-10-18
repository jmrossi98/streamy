/**
 * Who is playing something on Jellyfin itself right now: the Roku, the Jellyfin
 * apps, anyone on media.streamy-app.com. Streamy's own viewers also show up
 * here, as sessions from the Lightsail proxy's tailnet address; the Streaming
 * tab tells them apart with addressPlace().
 */

import { isJellyfinConfigured, jellyfinGet } from "./jellyfin";
import { describeJellyfinSession, type DescribedSession, type JellyfinSessionLike } from "./streamingHeadroomRules";
import { cached } from "./ttlCache";

const CACHE_MS = 5_000;

export async function getJellyfinPlayingSessions(): Promise<DescribedSession[] | null> {
  if (!isJellyfinConfigured()) return null;
  return cached("jellyfin:sessions:playing", CACHE_MS, async () => {
    try {
      const sessions = await jellyfinGet<JellyfinSessionLike[]>("/Sessions?activeWithinSeconds=60");
      return (sessions ?? []).map(describeJellyfinSession).filter((s): s is DescribedSession => s !== null);
    } catch {
      return null;
    }
  });
}
