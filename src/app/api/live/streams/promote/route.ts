import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refreshGuide, waitForLineupChannel, warmLiveChannel } from "@/lib/liveTv";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { namesGameDate } from "@/lib/liveGuideGrid";
import { feedLanguageRank } from "@/lib/gameStreamRules";
import {
  isDispatcharrConfigured,
  listChannels,
  nextChannelNumber,
  promoteStreamToChannel,
} from "@/lib/dispatcharr";

/**
 * Adds a stream to the published lineup.
 *
 * Any signed-in viewer, not just admins: finding something in the catalogue
 * worth adding is the same "this should be in Live TV" call whoever makes
 * it, and there's no separate approval step for it to wait on -- it appears
 * for everyone the moment Jellyfin picks up the change, same as it always
 * did. Blast radius is real (a channel added here appears for every viewer,
 * and it makes Jellyfin re-enumerate its tuner) but that's a reason for the
 * promote flow to behave predictably, not a reason to gate who can use it --
 * unlike removing one (see the demote route), a bad add is cheap to undo.
 *
 * The new channel does NOT appear in Streamy immediately. Jellyfin caches its
 * channel list and only picks up a lineup change on its next refresh, which is
 * why the response says so rather than letting the panel imply otherwise --
 * "I added it and nothing happened" is the obvious next report if it does not.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // Already in the lineup -- the same stream, or a channel of the same name
  // -- is answered with that channel rather than a second copy. Two viewers
  // adding the same game feed from its game page left two "Patriots at
  // Bills" channels in the lineup (2026-10-16). Unreadable lineup: carry on
  // and add; a duplicate is cheaper than a refused add.
  // An automatic add (Live Now's Watch) is one per game: the first viewer's
  // page adds it, everyone after finds it already there.
  const autoFixtureId = body?.auto === true && typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "";
  if (autoFixtureId) {
    const addedSoFar = await prisma.gameChannel.findMany({ where: { fixtureId: autoFixtureId } }).catch(() => []);
    const already = addedSoFar[0] ?? null;
    // ...unless this one names the game's date and what's there doesn't: a
    // standing slot's day-old label can be on another event entirely (the
    // Bruins slot showed soccer, 2026-10-18), so the dated feed is added too
    // and the game page defaults to it.
    const start = already ? (await getTodaysFixtures().catch(() => [])).find((f) => f.id === autoFixtureId)?.startUtc : null;
    const startMs = start ? Date.parse(start) : NaN;
    // Better than everything added so far: dated beats undated, then English
    // beats another language (a Portuguese DAZN feed was first for Man Utd at
    // Leeds while an English one was there).
    const rank = (n: string) => (namesGameDate(n, startMs) ? 0 : 2) + (feedLanguageRank(n) === 0 ? 0 : 1);
    const upgrade = !!already && addedSoFar.every((a) => rank(name) < rank(a.name));
    if (already && !upgrade) {
      return NextResponse.json({
        id: already.channelId,
        channelNumber: null,
        refreshing: false,
        existing: true,
        note: `Already added for this game as "${already.name}".`,
      });
    }
  }

  const existing = (await listChannels().catch(() => null))?.find(
    (c) => c.streamIds.includes(streamId) || c.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    return NextResponse.json({
      id: existing.id,
      channelNumber: null,
      refreshing: false,
      existing: true,
      note: `Already in the lineup as "${existing.name}".`,
    });
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

  // Added from a game page: remember which fixture it was for, so the
  // download warden's pass can remove it once that game is over (see
  // gameChannelCleanupRules.ts). Only these are recorded -- a channel added
  // from the general stream browser carries no fixtureId and is never
  // cleaned up. Best effort: failing to record costs a manual delete later,
  // not the add itself.
  const fixtureId = typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "";
  if (fixtureId) {
    await prisma.gameChannel
      .upsert({
        where: { channelId: created.id },
        create: { channelId: created.id, fixtureId, name },
        update: { fixtureId, name, endedSeenAt: null },
      })
      .catch((err) => console.error("[promote] couldn't record game channel:", err));
  }

  // Kick Jellyfin now rather than waiting for its own schedule, which can be
  // hours. Awaited rather than fired and forgotten so the response can say
  // which of the two things actually happened -- "added, refreshing" and
  // "added, but you will have to wait" are different messages, and guessing
  // between them is how "I added it and nothing happened" gets reported.
  const refreshing = await refreshGuide();
  // Answer once Jellyfin actually lists it, so the page can switch straight
  // away instead of waiting a fixed time and hoping (see waitForLineupChannel).
  const jellyfinId = refreshing ? await waitForLineupChannel(name) : null;
  const ready = jellyfinId != null;
  // Tune it once from here before anyone does (warmLiveChannel): Jellyfin
  // probes a channel for ~13 s the first time it is opened, and only then.
  // Paid now, while the game page is still holding, rather than inside the
  // first viewer's tune -- where on 2026-10-25 the probe's own disconnect
  // knocked Dispatcharr's channel over for a minute.
  const warmed = ready ? await warmLiveChannel(jellyfinId) : false;

  return NextResponse.json({
    id: created.id,
    channelNumber,
    refreshing,
    ready,
    // So the game page can play it straight away, without reloading.
    jellyfinId,
    // Probed and started once already, so that first play starts in seconds.
    warmed,
    note: refreshing
      ? "Added. Jellyfin is refreshing its guide now - it appears in Live TV in a moment."
      : "Added to Dispatcharr, but Jellyfin didn't accept a refresh. It appears on Jellyfin's next scheduled guide update.",
  });
}
