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
import { getChannelInfo, getMappedChannelPrograms, listIptvAccountsCached, type ChannelInfo } from "@/lib/dispatcharr";
import { getAutomaticRenewals } from "@/lib/renewals";
import { providerAlert } from "@/lib/credentialRules";
import { channelProviderState, providerAvailability } from "@/lib/providerAvailability";
import { fixtureGuidePrograms, trimGuidePrograms, type GuideProgram } from "@/lib/liveGuideGrid";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { getLiveScheduleForRender } from "@/lib/liveSchedule";
import { parseLiveTab } from "@/lib/liveTabs";
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

export default async function LivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  unstable_noStore();
  const rawTab = (await searchParams).tab;
  const tab = parseLiveTab(Array.isArray(rawTab) ? rawTab[0] : rawTab);
  const session = await getSession();
  if (!session) redirect("/login?callbackUrl=/live");

  // Started now, awaited at the end: the schedule (ESPN + an EPG match) runs
  // alongside the Jellyfin/Dispatcharr work below instead of after the page
  // reaches the browser, so "Live now" arrives with the rest of the page.
  const schedulePromise = tab === "now" ? getLiveScheduleForRender() : Promise.resolve(null);

  // Two probed facts, then the channels themselves. There is deliberately no
  // separate "is a tuner configured" probe: the one that existed asked a
  // POST-only endpoint with GET and reported "no tuner" for a server that had
  // two. Channels are what the page needs, so they are what it asks for.
  const elapsed = startStopwatch();
  const envSet = isJellyfinConfiguredForLiveTv();
  const reachable = envSet ? await timed("isJellyfinReachable", isJellyfinReachable()) : false;
  const channels = reachable
    ? await timed("attachNextPrograms", attachNextPrograms(await timed("getLiveChannels", getLiveChannels())))
    : [];

  // Everything below depends only on the channel list (logos also on the
  // Dispatcharr info), so it runs side by side. It used to run one step after
  // another, and a tab switch -- a full server render -- took 8-11 s with
  // nothing on screen changing (2026-10-24: "selecting the other tabs doesn't
  // respond"). Each step stays best effort: a failure costs its labels, never
  // the grid. `timed` logs any step over 300 ms, so the slow one is visible.
  const names = channels.map((c) => c.name);

  // Plain object, not the Map getChannelInfo returns -- this crosses the
  // server/client boundary as a prop, which a Map does not survive.
  const infoPromise: Promise<Record<string, ChannelInfo>> = timed("getChannelInfo", getChannelInfo())
    .then((info) => (info ? Object.fromEntries(info) : {}))
    .catch((err) => {
      console.error("[live] getChannelInfo failed:", err);
      return {};
    });

  // Which channels can't be tuned right now because their provider's lines are
  // all in use (or the provider is offline), so the grid can say so instead of
  // opening into a spinner.
  const providerPromise: Promise<Record<string, "ok" | "full" | "down">> = Promise.all([
    timed("listIptvAccounts", listIptvAccountsCached()),
    timed("renewals", getAutomaticRenewals().catch(() => [])),
    infoPromise,
  ])
    .then(([accounts, renewals, info]) => {
      const expired = new Set(
        renewals.filter((r) => r.source === "iptv" && providerAlert(r)?.tone === "danger").map((r) => r.name.toLowerCase())
      );
      const availability = providerAvailability(accounts, expired);
      const out: Record<string, "ok" | "full" | "down"> = {};
      for (const c of channels) {
        const state = channelProviderState(info[c.name]?.provider, availability);
        if (state) out[c.name] = state;
      }
      return out;
    })
    .catch((err) => {
      console.error("[live] provider availability failed:", err);
      return {};
    });

  // Logos for the channels Jellyfin has no image for.
  const logoPromise: Promise<Record<string, string>> = infoPromise
    .then((info) => timed("resolveLogoFallbacks", resolveLogoFallbacks(channels, info)))
    .catch((err) => {
      console.error("[live] resolveLogoFallbacks failed:", err);
      return {};
    });

  // channelStatuses resolves the schedule once for the whole set rather than
  // per tile.
  const statusPromise: Promise<Record<string, ChannelVerdict>> = timed("channelStatuses", channelStatuses(names))
    .then((statuses) => Object.fromEntries(statuses))
    .catch((err) => {
      console.error("[live] channelStatuses failed:", err);
      return {};
    });

  // The Guide tab's time grid. Only fetched for that tab: it is three
  // Dispatcharr lists (one ~10k rows) that no other tab draws from. Game feeds
  // have no guide anywhere; today's schedule fills them in.
  const guidePromise: Promise<Record<string, GuideProgram[]>> =
    tab === "guide" && channels.length > 0
      ? Promise.all([
          timed("getMappedChannelPrograms", getMappedChannelPrograms()).catch((err) => {
            console.error("[live] getMappedChannelPrograms failed:", err);
            return null;
          }),
          timed("guideFixtures", getTodaysFixtures()).catch((err) => {
            console.error("[live] schedule for the guide failed:", err);
            return null;
          }),
        ]).then(([programs, fixtures]) => {
          const trimmed = programs ? trimGuidePrograms(programs) : {};
          return fixtures ? { ...trimmed, ...fixtureGuidePrograms(names, fixtures, trimmed) } : trimmed;
        })
      : Promise.resolve({});

  // Only decides whether the Guide tab shows a "Manage channels" link to
  // /admin/live-tv, which has its own gate. Re-checked against the database
  // rather than read from the session token, like every other admin surface.
  const adminPromise = requireAdmin(session).then((a) => !!a);

  const listsPromise = getValidSessionUserId(session).then((userId) =>
    userId
      ? Promise.all([
          prisma.watchlistChannelItem
            .findMany({ where: { userId }, select: { channelId: true } })
            .then((rows) => rows.map((r) => r.channelId)),
          prisma.hiddenChannelItem.findMany({
            where: { userId },
            select: { channelId: true, name: true },
            orderBy: { name: "asc" },
          }),
        ])
      : ([[], []] as [string[], { channelId: string; name: string }[]])
  );

  const [infoByChannel, providerStateByChannel, logoFallbacks, statusByChannel, guidePrograms, isAdmin, [myListIds, hidden]] =
    await Promise.all([infoPromise, providerPromise, logoPromise, statusPromise, guidePromise, adminPromise, listsPromise]);
  console.log(`[live] render tab=${tab} ms=${elapsed()}`);

  const initialFixtures = await schedulePromise;

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
        providerStateByChannel={providerStateByChannel}
        guidePrograms={guidePrograms}
        initialFixtures={initialFixtures}
      />
    </div>
  );
}

/** A render's elapsed time in ms, kept out of the component body. */
function startStopwatch(): () => number {
  const t = Date.now();
  return () => Date.now() - t;
}

/** Awaits `p`, logging how long it took when that's long enough to matter. */
async function timed<T>(label: string, p: Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await p;
  } finally {
    const ms = Date.now() - t;
    if (ms > 300) console.log(`[live] step=${label} ms=${ms}`);
  }
}
