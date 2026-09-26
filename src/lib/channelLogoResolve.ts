/**
 * A usable logo for every channel that can have one.
 *
 * Three sources, in the order they should be trusted:
 *
 *   1. Jellyfin's own image, already on the channel. It only exists for logos
 *      Jellyfin managed to fetch, which is why some channels have none.
 *   2. A local copy we cached ourselves, which survives the provider's picon
 *      host going away -- see channelLogoCache.ts.
 *   3. A sibling channel of the same network. Last, because it is the only
 *      one that is inference rather than this channel's own artwork.
 *
 * Caching before borrowing matters: a cached logo is the channel's real mark,
 * a borrowed one is its network's. Preferring the borrow would replace
 * correct artwork with merely plausible artwork.
 */
import { borrowLogo, type LogoCandidate } from "./channelLogoMatch";
import { cacheLogo, cachedLogoUrl } from "./channelLogoCache";
import type { ChannelInfo } from "./dispatcharr";

/** Only what this needs from a channel, so callers are not forced to a shape. */
export type LogoChannel = { name: string; logoUrl: string | null };

/**
 * Fallback logo per channel name, for channels that have none of their own.
 *
 * Channels that already have an image are absent from the result rather than
 * echoed back: the caller falls back to this map only when the channel's own
 * logo is missing, and returning both would invite using the wrong one.
 */
export async function resolveLogoFallbacks(
  channels: LogoChannel[],
  infoByChannel: Record<string, ChannelInfo>
): Promise<Record<string, string>> {
  const missing = channels.filter((c) => !c.logoUrl);
  if (missing.length === 0) return {};

  // Cache attempts run together: each is a fetch of a few KB from a host that
  // is as likely to be down as up, and doing twenty-five sequentially would
  // put every one of those timeouts on the page's critical path.
  const cached = await Promise.all(
    missing.map(async (c) => {
      const upstream = infoByChannel[c.name]?.logoUrl;
      if (!upstream) return [c.name, null] as const;
      const key = await cacheLogo(upstream);
      return [c.name, key ? cachedLogoUrl(key) : null] as const;
    })
  );

  const out: Record<string, string> = {};
  for (const [name, url] of cached) {
    if (url) out[name] = url;
  }

  // Candidates include what was just cached, so a channel whose own logo is
  // gone can borrow from a sibling whose logo we only have because we cached
  // it a moment ago.
  const candidates: LogoCandidate[] = [
    ...channels
      .filter((c) => c.logoUrl)
      .map((c) => ({ name: c.name, logoUrl: c.logoUrl as string })),
    ...Object.entries(out).map(([name, logoUrl]) => ({ name, logoUrl })),
  ];

  for (const c of missing) {
    if (out[c.name]) continue;
    const borrowed = borrowLogo(c.name, candidates);
    if (borrowed) out[c.name] = borrowed;
  }

  return out;
}
