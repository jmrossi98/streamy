import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChannelWatchlistButton } from "@/components/ChannelWatchlistButton";
import { getLiveChannel, isJellyfinReachable } from "@/lib/liveTv";
import { LivePlayer } from "@/components/LivePlayer";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

/**
 * One channel's page, the same shape as a movie or show.
 *
 * Replaces the full-screen overlay the grid used to open. An overlay has no
 * URL, so a channel couldn't be linked, bookmarked, reloaded, or reached with
 * the back button -- all things people expect of anything else in the app.
 */
export const dynamic = "force-dynamic";

export default async function LiveChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  unstable_noStore();
  const { channelId } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?callbackUrl=/live/${channelId}`);
  if (!(await isJellyfinReachable())) notFound();

  const channel = await getLiveChannel(channelId);
  if (!channel) notFound();

  const userId = await getValidSessionUserId(session);
  const inList = userId
    ? !!(await prisma.watchlistChannelItem.findUnique({
        where: { userId_channelId: { userId, channelId } },
        select: { channelId: true },
      }))
    : false;

  const now = channel.now;

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        <Link href="/live" className="text-sm text-white/50 transition-colors hover:text-white">
          ← Live TV
        </Link>

        <div className="mb-4 mt-3 flex items-baseline gap-3">
          {channel.number && (
            <span className="shrink-0 tabular-nums text-sm text-white/40">{channel.number}</span>
          )}
          <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
            {channel.name}
          </h1>
          <span className="ml-auto">
            <ChannelWatchlistButton
              channelId={channel.id}
              name={channel.name}
              initialInList={inList}
            />
          </span>
        </div>

        <LivePlayer
          channelId={channel.id}
          channelName={channel.name}
          nowPlaying={now?.name ?? null}
        />

        {now && (
          <div className="mt-6 max-w-3xl">
            <h2 className="text-lg font-semibold text-white">{now.name}</h2>
            {now.episodeTitle && (
              <p className="text-sm text-white/60">{now.episodeTitle}</p>
            )}
            {now.overview && (
              <p className="mt-2 text-sm leading-relaxed text-white/70">{now.overview}</p>
            )}
          </div>
        )}

        {channel.next && (
          <div className="mt-5 max-w-3xl border-t border-white/10 pt-4">
            <p className="text-xs uppercase tracking-wide text-white/40">Up next</p>
            <p className="text-sm text-white/80">{channel.next.name}</p>
          </div>
        )}
      </div>
    </div>
  );
}
