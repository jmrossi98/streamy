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
import { providerAlert } from "./credentialRules";

/**
 * "nolines": every line of the provider has been removed (Jake, 2026-11-15:
 * "there could be a time where i need to remove all of them"), so there is
 * nothing to tune with until one is added again.
 */
export type ProviderState = "ok" | "full" | "down" | "nolines";

export type ProviderAvailability = {
  /** Lines not currently in use. */
  free: number;
  /** Working lines in total. */
  capacity: number;
  state: ProviderState;
};

export type AccountLike = { name: string; lines: IptvLine[] };

/**
 * The lines that can stream: switched on, not reported dead, and not the main
 * login when the renewal probe says that login has lapsed.
 *
 * The probe (mediabox iptv-subscriptions.py) asks with the main login only, so
 * its "Expired" is about that login, not the provider. Treating it as the
 * whole provider is what broke 2026-11-25: trex's main login had lapsed on
 * 11-15 while Lines 2 and 3 worked, and every trex channel read "Provider
 * offline", trex left the game pages' un-added feeds, and Barcelona's page
 * passed over trex's own feeds for DAZN Combat on strong8k.
 */
export function workingLines(lines: IptvLine[], mainLoginExpired = false, now: number = Date.now()): IptvLine[] {
  return lines.filter((l) => l.active && !isLineDead(l, now) && !(l.isDefault && mainLoginExpired));
}

/** Lowercased names of the IPTV providers the renewal probe says have lapsed (their main login). */
export function expiredMainLogins(renewals: { source: string; name: string; daysLeft: number | null; detail?: string; problem?: string }[]): Set<string> {
  return new Set(renewals.filter((r) => r.source === "iptv" && providerAlert(r)?.tone === "danger").map((r) => r.name.trim().toLowerCase()));
}

/**
 * Lowercased names of the providers nothing can play from: every line dead.
 * Without the line list (Dispatcharr unreachable) the probe's word is all
 * there is, so a lapsed main login counts as the provider.
 */
export function deadProviders(accounts: AccountLike[] | null | undefined, expired: Set<string>, now: number = Date.now()): Set<string> {
  if (!accounts) return new Set(expired);
  const dead = new Set<string>();
  const known = new Set<string>();
  for (const a of accounts) {
    const key = a.name.trim().toLowerCase();
    known.add(key);
    if (workingLines(a.lines, expired.has(key), now).length === 0) dead.add(key);
  }
  for (const key of expired) if (!known.has(key)) dead.add(key);
  return dead;
}

/**
 * provider name (lowercased) -> availability. `expired` is the set of provider
 * names whose main login the renewal probe says has lapsed (expiredMainLogins):
 * it rules out that line, not the provider -- see workingLines.
 */
export function providerAvailability(
  accounts: AccountLike[] | null | undefined,
  expired: Set<string> = new Set()
): Record<string, ProviderAvailability> {
  const out: Record<string, ProviderAvailability> = {};
  for (const a of accounts ?? []) {
    const key = a.name.trim().toLowerCase();
    const working = workingLines(a.lines, expired.has(key));
    const capacity = working.reduce((n, l) => n + Math.max(0, l.maxStreams || 0), 0);
    const free = working.reduce((n, l) => n + Math.max(0, (l.maxStreams || 0) - (l.viewers || 0)), 0);
    const down = working.length === 0;
    const state = !a.lines.some((l) => l.active) ? "nolines" : down ? "down" : capacity > 0 && free <= 0 ? "full" : "ok";
    out[key] = { free, capacity, state };
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
  if (state === "nolines") return "No active provider lines";
  return null;
}
