/**
 * Which quality profile a request lands on.
 *
 * Admins request in 4K; everyone else gets 1080p. Pure policy with no
 * imports, so it can be tested without the Radarr/Sonarr clients.
 *
 * ## This is a property of the file, not of the viewer
 *
 * Worth stating plainly because the naming invites the opposite reading:
 * there is one copy of each title in the library. An admin requesting a
 * movie means *that movie* is 4K for everyone who watches it afterwards,
 * transcoded down for clients that cannot handle it. It is not a per-user
 * playback quality, and it cannot be -- per-user limits belong in
 * Jellyfin's streaming bitrate policy, which is a separate control.
 */

export type QualityTier = "hd" | "uhd";

/** Admins get 4K. The default is deliberately the cheaper one. */
export function tierForUser(isAdmin: boolean): QualityTier {
  return isAdmin ? "uhd" : "hd";
}

/**
 * Resolves a tier to a Radarr/Sonarr profile id.
 *
 * Falls back to the HD profile whenever the 4K one is unset or unparseable,
 * rather than failing the request. An unconfigured 4K profile should mean
 * "nobody gets 4K yet", not "admins cannot download anything" -- and since
 * this ships before the env vars are set anywhere, that fallback is the
 * entire behaviour on day one.
 */
export function resolveQualityProfileId(
  tier: QualityTier,
  hdProfileId: string | undefined,
  uhdProfileId: string | undefined
): number | null {
  const hd = toId(hdProfileId);
  if (tier === "hd") return hd;
  return toId(uhdProfileId) ?? hd;
}

function toId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  // Profile ids are positive integers; 0 and NaN both mean "not configured"
  // and must not be sent to Radarr as a real id.
  return Number.isFinite(n) && n > 0 ? n : null;
}
