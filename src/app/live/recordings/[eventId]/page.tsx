import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { needsForcedTranscode } from "@/lib/jellyfin";
import { findJellyfinRecordingItemId, getSportarrEvent, isSportarrConfigured } from "@/lib/sportarr";
import { liveTabHref } from "@/lib/liveTabs";
import { RecordingPlayer } from "@/components/RecordingPlayer";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ eventId: string }> };

/**
 * Plays one game recording. The Sports and Recordings tabs link here once
 * Sportarr has the file; the stream itself goes through /api/stream/sports.
 */
export default async function RecordingWatchPage({ params }: Props) {
  const session = await getSession();
  const { eventId: raw } = await params;
  if (!(await getValidSessionUserId(session))) redirect(`/login?callbackUrl=${encodeURIComponent(`/live/recordings/${raw}`)}`);

  const eventId = Number.parseInt(raw, 10);
  if (!Number.isInteger(eventId) || eventId <= 0 || !isSportarrConfigured()) notFound();

  const event = await getSportarrEvent(eventId);
  if (!event) notFound();

  const itemId = event.hasFile ? await findJellyfinRecordingItemId(event) : null;
  const forceTranscode = itemId ? await needsForcedTranscode(itemId, (await headers()).get("user-agent")) : false;

  const when = new Date(event.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

  return (
    <div className="relative min-h-screen bg-netflix-black">
      <RecordingPlayer
        eventId={event.id}
        title={event.title}
        subtitle={`${event.leagueName} · ${when}`}
        videoUrl={itemId ? `/api/stream/sports/${event.id}` : null}
        closeHref={liveTabHref("recordings")}
        forceTranscode={forceTranscode}
      />
    </div>
  );
}
