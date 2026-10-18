"use client";

import type { IncomingEvent, PlaybackEventKind, PlayingNow } from "./viewerActivityRules";

/**
 * The tab's side of the admin Viewers panel: what it is playing and the
 * playback events waiting to be sent. Players write here
 * (usePlaybackTelemetry); PresenceReporter reads it on every heartbeat.
 * Module state on purpose -- one tab, one player at a time.
 */

const SESSION_KEY = "streamy-presence-id";
let playing: PlayingNow | null = null;
let queue: IncomingEvent[] = [];
let onUrgent: (() => void) | null = null;

/** This tab's id: survives reloads, not new tabs, so each device and tab is its own row. */
export function presenceSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "nostorage" + Math.floor(Date.now() / 3_600_000);
  }
}

export function setPlayingNow(next: PlayingNow | null): void {
  playing = next;
}

export function updatePlayingState(state: PlayingNow["state"], error: string | null = null): void {
  if (playing) playing = { ...playing, state, error };
}

export function queuePlaybackEvent(kind: PlaybackEventKind, media: string, detail?: string | null, ms?: number | null): void {
  queue.push({ kind, media, detail: detail ?? null, ms: ms ?? null, at: Date.now() });
  if (queue.length > 200) queue = queue.slice(-200);
  // Problems go out straight away, so the admin sees them while they happen.
  if (kind === "error" || kind === "retry") onUrgent?.();
}

/** What the next heartbeat carries; the queue empties as it's taken. */
export function takePresence(): { playing: PlayingNow | null; events: IncomingEvent[] } {
  const events = queue;
  queue = [];
  return { playing, events };
}

/** PresenceReporter registers how to send early. */
export function onUrgentPresence(fn: (() => void) | null): void {
  onUrgent = fn;
}
