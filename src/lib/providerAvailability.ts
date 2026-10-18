/**
 * Whether a channel can be tuned right now, from its provider's spare lines. Pure.
 *
 * Each IPTV provider allows only so many streams at once (its lines, one
 * connection each). When they are all in use, tuning another channel on that
 * provider fails -- the viewer used to get an endless "tuning" spinner. This
 * turns Dispatcharr's line counts into a per-provider verdict so a channel on a
 * used-up (or dead) provider can be marked unavailable before it is tried, and
 * the reason shown.
 */

import { isLineDead, type IptvLine } from "./iptvLineRules";

export type ProviderState = "ok" | "full" | "down";

export type ProviderAvailability = {
  /** Lines not currently in use. */
  free: number;
  /** Working lines in total. */
  capacity: number;
  state: ProviderState;
};

export type AccountLike = { name: string; lines: IptvLine[] };

/**
 * provider name (lowercased) -> availability. `expired` is the set of provider
 * names whose subscription has lapsed (getAutomaticRenewals + providerAlert),
 * which no line count can reveal.
 */
export function providerAvailability(
  accounts: AccountLike[] | null | undefined,
  expired: Set<string> = new Set()
): Record<string, ProviderAvailability> {
  const out: Record<string, ProviderAvailability> = {};
  for (const a of accounts ?? []) {
    const key = a.name.trim().toLowerCase();
    const working = a.lines.filter((l) => l.active && !isLineDead(l));
    const capacity = working.reduce((n, l) => n + Math.max(0, l.maxStreams || 0), 0);
    const free = working.reduce((n, l) => n + Math.max(0, (l.maxStreams || 0) - (l.viewers || 0)), 0);
    const down = expired.has(key) || working.length === 0;
    out[key] = { free, capacity, state: down ? "down" : capacity > 0 && free <= 0 ? "full" : "ok" };
  }
  return out;
}

/** A channel's provider verdict, or null when the provider isn't one we track. */
export function channelProviderState(
  provider: string | null | undefined,
  availability: Record<string, ProviderAvailability>
): ProviderState | null {
  if (!provider) return null;
  return availability[provider.trim().toLowerCase()]?.state ?? null;
}

/** Short label for a non-ok state, or null when the channel is fine to tune. */
export function unavailableLabel(state: ProviderState | null): string | null {
  if (state === "full") return "Lines in use";
  if (state === "down") return "Provider offline";
  return null;
}
