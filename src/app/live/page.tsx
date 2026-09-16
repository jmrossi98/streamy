import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  attachNextPrograms,
  getLiveChannels,
  isJellyfinConfiguredForLiveTv,
  isJellyfinReachable,
  MAX_CHANNELS,
} from "@/lib/liveTv";
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
      />
    </div>
  );
}
