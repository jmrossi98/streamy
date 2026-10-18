import { unstable_noStore } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLiveChannels, isJellyfinConfiguredForLiveTv, isJellyfinReachable } from "@/lib/liveTv";
import { getChannelInfo, isDispatcharrConfigured, type ChannelInfo } from "@/lib/dispatcharr";
import { EpgBackfillButton } from "@/components/EpgBackfillButton";
import { channelStatuses } from "@/lib/liveChannelHealth";
import type { ChannelVerdict } from "@/lib/liveChannelRules";
import { resolveLogoFallbacks } from "@/lib/channelLogoResolve";
import { AdminSection } from "@/components/ui";
import { StreamBrowser } from "@/components/StreamBrowser";
import { AdminLiveTvLineup } from "@/components/AdminLiveTvLineup";

/**
 * Live TV management: what is in the lineup, and what is not.
 *
 * Everything here used to sit at the top of /live itself -- Select mode,
 * bulk hide and delete, the Hidden channels panel, and the stream browser --
 * above the channels anyone came to watch. Moved on 2026-10-16 so the
 * viewing page is only for viewing, the way YouTube TV keeps its settings
 * out of the Live/Library/Sports tabs. The admin layout gates the route.
 *
 * Lighter than /live's load on purpose: no guide data, no per-channel health
 * sampling. This page is for picking channels out by name, which the name,
 * logo and provider label are enough for.
 */
export const dynamic = "force-dynamic";

export default async function AdminLiveTvPage() {
  unstable_noStore();
  const session = await getSession();

  const envSet = isJellyfinConfiguredForLiveTv();
  const reachable = envSet ? await isJellyfinReachable() : false;
  const channels = reachable ? await getLiveChannels() : [];

  const userId = await getValidSessionUserId(session);

  // The three reads that only need the channel list go out together. They
  // used to be awaited one after another, which with the two above made six
  // round trips before anything rendered. Each is best effort, same reasoning
  // as on /live: a Dispatcharr hiccup costs the provider labels, not the page.
  const [info, statuses, hidden] = await Promise.all([
    getChannelInfo().catch((err) => {
      console.error("[admin/live-tv] getChannelInfo failed:", err);
      return null;
    }),
    // The verdicts viewers' cards carry, so what is hidden from them is badged
    // here rather than silently absent from one page and present on the other.
    channelStatuses(channels.map((c) => c.name)).catch((err) => {
      console.error("[admin/live-tv] channelStatuses failed:", err);
      return new Map<string, ChannelVerdict>();
    }),
    // Hiding is per viewer, so this is the admin's own hidden list -- the same
    // one the Hidden panel on /live used to show them.
    userId
      ? prisma.hiddenChannelItem.findMany({
          where: { userId },
          select: { channelId: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  // Plain objects, since a Map does not survive the server/client boundary.
  const infoByChannel: Record<string, ChannelInfo> = info ? Object.fromEntries(info) : {};
  const statusByChannel: Record<string, ChannelVerdict> = Object.fromEntries(statuses);

  let logoFallbacks: Record<string, string> = {};
  try {
    logoFallbacks = await resolveLogoFallbacks(channels, infoByChannel);
  } catch (err) {
    console.error("[admin/live-tv] resolveLogoFallbacks failed:", err);
  }

  return (
    <div className="space-y-10">
      <AdminSection title="Lineup">
        <AdminLiveTvLineup
          envSet={envSet}
          reachable={reachable}
          channels={channels}
          hiddenChannels={hidden}
          infoByChannel={infoByChannel}
          statusByChannel={statusByChannel}
          logoFallbacks={logoFallbacks}
        />
        {/* A guide action, so it lives with the lineup rather than under Health
            -> Services where it sat until 2026-10-18. */}
        <EpgBackfillButton configured={isDispatcharrConfigured()} />
      </AdminSection>

      {/*
        Below the lineup rather than beside it. Rendered even when the tuner
        is unreachable, since an empty lineup is exactly when someone wants
        to add to it. StreamBrowser draws its own heading.
      */}
      <StreamBrowser />
    </div>
  );
}
