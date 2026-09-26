import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { channelStatuses } from "@/lib/liveChannelHealth";
import { resolveLogoFallbacks } from "@/lib/channelLogoResolve";
import type { ChannelVerdict } from "@/lib/liveChannelRules";
import { getSession, getValidSessionUserId, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  attachNextPrograms,
  getLiveChannels,
  isJellyfinConfiguredForLiveTv,
  isJellyfinReachable,
  MAX_CHANNELS,
} from "@/lib/liveTv";
import { getChannelInfo, type ChannelInfo } from "@/lib/dispatcharr";
import { LiveTvContent } from "./LiveTvContent";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

/**
 * Live TV.
 *
 * Signed-in household viewers, not admin-only like /games -- the whole point
 * is that anyone on the Roku can watch. The guide is current-by-definition, so
 * nothing here is cached.
 */
export const dynamic = "force-dynamic";

export default async function LivePage() {
  unstable_noStore();
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/live");

  // Two probed facts, then the channels themselves. There is deliberately no
  // separate "is a tuner configured" probe: the one that existed asked a
  // POST-only endpoint with GET and reported "no tuner" for a server that had
  // two. Channels are what the page needs, so they are what it asks for.
  const envSet = isJellyfinConfiguredForLiveTv();
  const reachable = envSet ? await isJellyfinReachable() : false;
  const channels = reachable ? await attachNextPrograms(await getLiveChannels()) : [];

  // Best effort, same reasoning as everywhere else this gets joined against
  // Jellyfin's own channel list: a Dispatcharr hiccup must not take the grid
  // down, only cost it the provider and dead-stream labels. Plain object,
  // not the Map getChannelInfo returns -- this crosses the server/client
  // boundary as a prop, which a Map does not survive.
  let infoByChannel: Record<string, ChannelInfo> = {};
  try {
    const info = await getChannelInfo();
    if (info) infoByChannel = Object.fromEntries(info);
  } catch (err) {
    console.error("[live] getChannelInfo failed:", err);
  }

  // Logos for the channels Jellyfin has no image for. Best effort: a picon
  // host that is down costs a tile its artwork, never the grid.
  let logoFallbacks: Record<string, string> = {};
  try {
    logoFallbacks = await resolveLogoFallbacks(channels, infoByChannel);
  } catch (err) {
    console.error("[live] resolveLogoFallbacks failed:", err);
  }

  // Best effort for the same reason as the Dispatcharr join above: a dead
  // sampler or an unreachable scoreboard costs the badges, not the grid.
  // channelStatuses resolves the schedule once for the whole set rather than
  // per tile.
  let statusByChannel: Record<string, ChannelVerdict> = {};
  try {
    const statuses = await channelStatuses(channels.map((c) => c.name));
    statusByChannel = Object.fromEntries(statuses);
  } catch (err) {
    console.error("[live] channelStatuses failed:", err);
  }

  // Gates the stream browser below. Re-checked against the database rather
  // than read from the session token, like every other admin surface here.
  const isAdmin = !!(await requireAdmin(session));

  const userId = await getValidSessionUserId(session);
  const [myListIds, hidden] = userId
    ? await Promise.all([
        prisma.watchlistChannelItem
          .findMany({ where: { userId }, select: { channelId: true } })
          .then((rows) => rows.map((r) => r.channelId)),
        prisma.hiddenChannelItem.findMany({
          where: { userId },
          select: { channelId: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <LiveTvContent
        envSet={envSet}
        reachable={reachable}
        channels={channels}
        truncated={channels.length >= MAX_CHANNELS}
        myListIds={myListIds}
        hiddenChannels={hidden}
        isAdmin={isAdmin}
        infoByChannel={infoByChannel}
        statusByChannel={statusByChannel}
        logoFallbacks={logoFallbacks}
      />
    </div>
  );
}
