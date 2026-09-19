import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { refreshGuide } from "@/lib/liveTv";
import {
  isDispatcharrConfigured,
  nextChannelNumber,
  promoteStreamToChannel,
} from "@/lib/dispatcharr";

/**
 * Adds a stream to the published lineup.
 *
 * Admin only, and the stricter of the two reasons is not authorisation but
 * blast radius: a channel added here appears for every viewer, and it also
 * makes Jellyfin re-enumerate its tuner.
 *
 * The new channel does NOT appear in Streamy immediately. Jellyfin caches its
 * channel list and only picks up a lineup change on its next refresh, which is
 * why the response says so rather than letting the panel imply otherwise --
 * "I added it and nothing happened" is the obvious next report if it does not.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isDispatcharrConfigured()) {
    return NextResponse.json(
      { error: "Dispatcharr isn't configured on the server." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const streamId = Number(body?.streamId);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!Number.isInteger(streamId) || streamId <= 0) {
    return NextResponse.json({ error: "streamId required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  // Chosen here rather than left to Dispatcharr, which assigns nothing: a
  // lineup of channels all numbered zero sorts arbitrarily in every client.
  const channelNumber =
    typeof body?.channelNumber === "number" && body.channelNumber > 0
      ? body.channelNumber
      : await nextChannelNumber();

  const created = await promoteStreamToChannel({
    streamId,
    name,
    channelNumber,
    groupId: typeof body?.groupId === "number" ? body.groupId : null,
    // Taken from the row the panel already has rather than re-fetched: the
    // browser listed this stream a moment ago and knows its artwork.
    logoUrl: typeof body?.logoUrl === "string" ? body.logoUrl : null,
  });

  if (!created) {
    return NextResponse.json(
      { error: "Dispatcharr wouldn't add that stream." },
      { status: 502 }
    );
  }

  // Kick Jellyfin now rather than waiting for its own schedule, which can be
  // hours. Awaited rather than fired and forgotten so the response can say
  // which of the two things actually happened -- "added, refreshing" and
  // "added, but you will have to wait" are different messages, and guessing
  // between them is how "I added it and nothing happened" gets reported.
  const refreshing = await refreshGuide();

  return NextResponse.json({
    id: created.id,
    channelNumber,
    refreshing,
    note: refreshing
      ? "Added. Jellyfin is refreshing its guide now — it appears in Live TV in a moment."
      : "Added to Dispatcharr, but Jellyfin didn't accept a refresh. It appears on Jellyfin's next scheduled guide update.",
  });
}
