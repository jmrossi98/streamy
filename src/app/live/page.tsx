import { redirect } from "next/navigation";
import { unstable_noStore } from "next/cache";
import { getSession } from "@/lib/auth";
import {
  attachNextPrograms,
  getLiveChannels,
  isJellyfinReachable,
  isLiveTvConfigured,
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
  if (!(await getSession())) redirect("/login?callbackUrl=/live");

  const reachable = isJellyfinReachable();
  const configured = reachable ? await isLiveTvConfigured() : false;
  // Skipped entirely when there's no tuner: the channel query would just be a
  // round trip to an empty list, and the page has a different thing to say.
  const channels = configured ? await attachNextPrograms(await getLiveChannels()) : [];

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <LiveTvContent reachable={reachable} configured={configured} channels={channels} />
    </div>
  );
}
