/**
 * Keeps a VOD transcode session alive in Jellyfin between the player's
 * segment fetches. See playbackKeepaliveRules.ts for why.
 *
 * Server-side, one process-wide timer: every HLS request through the proxy
 * touches its session; every PING_EVERY_MS each session seen recently is
 * pinged. The timer only runs while there is something to ping.
 */
import { pingJellyfinPlaySession, isJellyfinConfigured } from "./jellyfin";
import { FORGET_AFTER_MS, PING_EVERY_MS, keepalivePlan } from "./playbackKeepaliveRules";

const lastSeen = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

/** An HLS request for this session just came through. */
export function touchPlaybackSession(playSessionId: string | null | undefined): void {
  if (!playSessionId || !isJellyfinConfigured()) return;
  lastSeen.set(playSessionId, Date.now());
  if (!timer) {
    timer = setInterval(tick, PING_EVERY_MS);
    // Never the reason the process stays up.
    timer.unref?.();
  }
}

/** The player stopped this session on purpose; no more pings for it. */
export function forgetPlaybackSession(playSessionId: string): void {
  lastSeen.delete(playSessionId);
}

function tick(): void {
  const { ping, drop } = keepalivePlan(lastSeen, Date.now(), FORGET_AFTER_MS);
  for (const id of drop) lastSeen.delete(id);
  for (const id of ping) pingJellyfinPlaySession(id);
  if (lastSeen.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}
