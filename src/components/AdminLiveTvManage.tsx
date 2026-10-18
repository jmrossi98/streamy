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
 * Live TV channel management: what is in the lineup, and what the providers'
 * catalogues have that isn't. Its own server component so it can sit at the
 * bottom of the admin Streaming tab -- the Live TV tab was folded in there on
 * 2026-10-18, so the one place for "is streaming working and what's in it" is
 * the same page. Lighter than /live on purpose: no guide data, no per-channel
 * health sampling, just names, logos and provider labels for picking channels.
 */
export async function AdminLiveTvManage() {
  const session = await getSession();

  const envSet = isJellyfinConfiguredForLiveTv();
  const reachable = envSet ? await isJellyfinReachable() : false;
  const channels = reachable ? await getLiveChannels() : [];

  const userId = await getValidSessionUserId(session);

  // The three reads that only need the channel list go out together, each best
  // effort: a Dispatcharr hiccup costs the provider labels, not the section.
  const [info, statuses, hidden] = await Promise.all([
    getChannelInfo().catch((err) => {
      console.error("[admin/live-tv] getChannelInfo failed:", err);
      return null;
    }),
    channelStatuses(channels.map((c) => c.name)).catch((err) => {
      console.error("[admin/live-tv] channelStatuses failed:", err);
      return new Map<string, ChannelVerdict>();
    }),
    userId
      ? prisma.hiddenChannelItem.findMany({
          where: { userId },
          select: { channelId: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const infoByChannel: Record<string, ChannelInfo> = info ? Object.fromEntries(info) : {};
  const statusByChannel: Record<string, ChannelVerdict> = Object.fromEntries(statuses);

  let logoFallbacks: Record<string, string> = {};
  try {
    logoFallbacks = await resolveLogoFallbacks(channels, infoByChannel);
  } catch (err) {
    console.error("[admin/live-tv] resolveLogoFallbacks failed:", err);
  }

  return (
    <>
      <AdminSection title="Live TV lineup">
        <AdminLiveTvLineup
          envSet={envSet}
          reachable={reachable}
          channels={channels}
          hiddenChannels={hidden}
          infoByChannel={infoByChannel}
          statusByChannel={statusByChannel}
          logoFallbacks={logoFallbacks}
        />
        {/* A guide action, so it lives with the lineup. */}
        <EpgBackfillButton configured={isDispatcharrConfigured()} />
      </AdminSection>

      {/* Below the lineup. Rendered even when the tuner is unreachable, since an
          empty lineup is exactly when someone wants to add to it. */}
      <StreamBrowser />
    </>
  );
}
