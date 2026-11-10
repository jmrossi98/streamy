import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refreshGuide, waitForLineupChannel, warmLiveChannel } from "@/lib/liveTv";
import { getTodaysFixtures } from "@/lib/sportsSchedule";
import { namesGameDate } from "@/lib/liveGuideGrid";
import { feedLanguageRank } from "@/lib/gameStreamRules";
import { cleanChannelName } from "@/lib/liveChannelRules";
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
  const userId = await getValidSessionUserId(await getSession());
  if (!userId) {
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
  // The name the channel is created under (promoteStreamToChannel cleans it)
  // and so the one Jellyfin lists. Compared and recorded as this, never as the
  // stream's own name: "US| EPL ARSENAL" becomes "EPL ARSENAL", and the raw
  // name matched nothing -- not the lineup's copy, not Jellyfin's listing, not
  // the game page's list of feeds added for the game.
  const channelName = cleanChannelName(name);
  const fixtureId = typeof body?.fixtureId === "string" ? body.fixtureId.trim() : "";
  // The viewer's own Watch on a game page, not the page's automatic add.
  const watchedForGame = fixtureId && body?.auto !== true ? fixtureId : "";

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
        // So the page can play it now; it is in the lineup already.
        jellyfinId: await listedOrRefresh(already.name),
        note: `Already added for this game as "${already.name}".`,
      });
    }
  }

  const sameName = (n: string) => cleanChannelName(n).toLowerCase() === channelName.toLowerCase();
  const existing = (await listChannels().catch(() => null))?.find(
    (c) => c.streamIds.includes(streamId) || sameName(c.name)
  );
  if (existing) {
    // Added from a game page, it is that game's channel from now on: listed on
    // its page like a feed added for it (2026-11-01, a stream already in the
    // lineup vanished from both lists -- "More streams" leaves out what is in
    // the lineup, and the game's list only had what was added for it). Linked,
    // not owned: the cleanup pass never removes a channel that was there first.
    if (fixtureId) await linkToGame(fixtureId, existing.id, existing.name);
    const existingJellyfinId = await listedOrRefresh(existing.name);
    if (watchedForGame) await rememberWatch(userId, watchedForGame, existing.name, existingJellyfinId);
    return NextResponse.json({
      id: existing.id,
      channelNumber: null,
      refreshing: false,
      existing: true,
      jellyfinId: existingJellyfinId,
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
  if (fixtureId) {
    await prisma.gameChannel
      .upsert({
        where: { channelId: created.id },
        create: { channelId: created.id, fixtureId, name: channelName },
        update: { fixtureId, name: channelName, endedSeenAt: null },
      })
      .catch((err) => console.error("[promote] couldn't record game channel:", err));
  }

  // Kick Jellyfin now rather than waiting for its own schedule, which can be
  // hours. Awaited rather than fired and forgotten so the response can say
  // which of the two things actually happened -- "added, refreshing" and
  // "added, but you will have to wait" are different messages, and guessing
  // between them is how "I added it and nothing happened" gets reported.
  const refreshing = await refreshGuide({ urgent: true });
  // Answer once Jellyfin actually lists it, so the page can switch straight
  // away instead of waiting a fixed time and hoping (see waitForLineupChannel).
  const jellyfinId = refreshing ? await waitForLineupChannel(channelName) : null;
  const ready = jellyfinId != null;
  if (watchedForGame) await rememberWatch(userId, watchedForGame, channelName, jellyfinId);
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

/**
 * Saves the viewer's Watch as their pick for the game now, not when it first
 * plays. Watch is add + play + remember, and Jellyfin can take minutes to list
 * a new channel: a reload in between used to forget both the wait and the
 * choice (2026-11-07). Saved by name when Jellyfin has no id for it yet --
 * the page matches a pick by id, then by name (resolveStoredChoice). Best
 * effort: a failure costs the remembering, never the add.
 */
async function rememberWatch(userId: string, fixtureId: string, name: string, jellyfinId: string | null): Promise<void> {
  const pickName = name.trim().replace(/\s+/g, " ");
  try {
    await prisma.gameChannelChoice.upsert({
      where: { userId_fixtureId: { userId, fixtureId } },
      create: { userId, fixtureId, channelId: jellyfinId ?? "", name: pickName },
      update: { channelId: jellyfinId ?? "", name: pickName, pickedAt: new Date() },
    });
  } catch (err) {
    console.error("[promote] couldn't remember the pick:", err);
  }
}

/**
 * Jellyfin's id for a channel already in the lineup, refreshing the guide when
 * Jellyfin doesn't list it yet. A feed the page added earlier can be in
 * Dispatcharr but missing from Jellyfin if that refresh never ran, and
 * answering "already added" without one left it missing for good: the
 * Islanders-Sharks feed on 2026-11-09 was asked for twice and never listed.
 */
async function listedOrRefresh(name: string): Promise<string | null> {
  const id = await waitForLineupChannel(name, 3_000);
  if (id) return id;
  // At most once every RELIST_COOLDOWN_MS per name: every viewer's page asks,
  // and a record left behind for a channel that is gone must not restart the
  // guide on each visit.
  const key = name.trim().toLowerCase();
  const now = Date.now();
  if (now - (relistAskedAt.get(key) ?? 0) < RELIST_COOLDOWN_MS) return null;
  relistAskedAt.set(key, now);
  return (await refreshGuide({ urgent: true })) ? waitForLineupChannel(name) : null;
}
const RELIST_COOLDOWN_MS = 2 * 60_000;
const relistAskedAt = new Map<string, number>();

/** How long a link to a game is kept: games are a day's business. */
const LINK_TTL_MS = 3 * 86_400_000;

/**
 * Lists a channel that was already in the lineup on a game's page. Best
 * effort, like recording a GameChannel: a failure costs the listing, not the
 * add. Old links are swept here, as game picks are on write.
 */
async function linkToGame(fixtureId: string, channelId: number, name: string): Promise<void> {
  try {
    await prisma.gameChannelLink.upsert({
      where: { fixtureId_channelId: { fixtureId, channelId } },
      create: { fixtureId, channelId, name },
      update: { name },
    });
    await prisma.gameChannelLink.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LINK_TTL_MS) } } });
  } catch (err) {
    console.error("[promote] couldn't link channel to game:", err);
  }
}
