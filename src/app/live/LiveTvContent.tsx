"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CHANNEL_CATEGORIES, classifyChannel, type LiveChannel } from "@/lib/liveTv";
import { looksLikePlaceholder } from "@/lib/liveTimeline";
import type { ChannelInfo } from "@/lib/dispatcharr";
import type { ChannelVerdict } from "@/lib/liveChannelRules";
import { isNotWorking } from "@/lib/liveChannelStateRules";
import { ChannelCard } from "@/components/ChannelCard";
import { LiveGuideGrid } from "@/components/LiveGuideGrid";
import { guideKey, programsForChannel, type GuideProgram } from "@/lib/liveGuideGrid";
import { SportsTab } from "@/components/SportsTab";
import { RecordingsTab } from "@/components/RecordingsTab";
import { LiveNowGames } from "@/components/LiveNowGames";
import type { ScheduleFixture } from "@/lib/liveSchedule";
import { Button, ButtonLink, Select, TabBar, TabLink, TextInput } from "@/components/ui";
import { ROW_H2_CLASS } from "@/lib/browseLayout";
import { groupIntoShelves } from "@/lib/liveShelves";
import { LIVE_TABS, liveTabHref, parseLiveTab, type LiveTab } from "@/lib/liveTabs";

type HiddenEntry = { channelId: string; name: string };

type Props = {
  /** JELLYFIN_URL/JELLYFIN_API_KEY are set. */
  envSet: boolean;
  /** Jellyfin actually answered a probe -- the server is up, not just configured. */
  reachable: boolean;
  channels: LiveChannel[];
  /** The fetch hit its cap -- there are more channels than are shown. */
  truncated: boolean;
  /** Channel ids on this viewer's My List. Pinned above everything else. */
  myListIds: string[];
  /** Channels this viewer has hidden from their lineup, name-snapshotted. */
  hiddenChannels: HiddenEntry[];
  /** Shows the link to channel management, which lives under /admin. */
  isAdmin: boolean;
  /** Channel name -> provider and dead-stream state, best effort. */
  infoByChannel: Record<string, ChannelInfo>;
  /** Channel name -> measured verdict. Plain object for the same reason
   *  infoByChannel is: a Map does not survive the server/client boundary. */
  statusByChannel: Record<string, ChannelVerdict>;
  /** Channel name -> a logo to use when the channel has none of its own. */
  logoFallbacks: Record<string, string>;
  /** Channel name -> its provider's availability: "full" = every line in use, "down" = offline. */
  providerStateByChannel: Record<string, "ok" | "full" | "down">;
  /** guideKey(channel name) -> EPG listings for the Guide grid. Empty off the Guide tab. */
  guidePrograms: Record<string, GuideProgram[]>;
  /** Today's schedule from the server render, so "Live now" needs no fetch of its own; null if it wasn't ready. */
  initialFixtures?: ScheduleFixture[] | null;
};

/** What every tab needs to draw a channel card. */
type CardLookups = Pick<Props, "infoByChannel" | "statusByChannel" | "logoFallbacks" | "providerStateByChannel">;

/** Rendered at once. Enough to scroll, few enough to stay responsive. */
const PAGE_SIZE = 60;

/** Leading numeric run of a channel number ("7.1" -> 7.1, "WGN" -> NaN). */
function numberValue(number: string | null): number {
  if (!number) return NaN;
  const m = number.match(/^\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * Live TV, in four tabs: Now, Guide, Sports, Recordings.
 *
 * One client component switching on `?tab=` rather than four routes: the
 * channels are loaded once by the server page and every tab draws from the
 * same list, so a route per tab would refetch the whole lineup on each
 * switch. See liveTabs.ts for why the tabs exist at all.
 *
 * Nothing here manages the lineup. Select mode, bulk hide/delete, the Hidden
 * channels panel and the stream browser all moved to /admin/live-tv
 * (2026-10-16): they were the first thing on the page and the last thing a
 * viewer wanted.
 */
export function LiveTvContent({
  envSet, reachable, channels, truncated, myListIds, hiddenChannels, isAdmin, infoByChannel,
  statusByChannel, logoFallbacks, providerStateByChannel, guidePrograms, initialFixtures = null,
}: Props) {
  // The page is force-dynamic, so this is available on the server render too
  // and the tab arrives in the first HTML rather than after hydration.
  const searchParams = useSearchParams();
  const tab = parseLiveTab(searchParams.get("tab"));

  const hiddenIds = useMemo(() => new Set(hiddenChannels.map((h) => h.channelId)), [hiddenChannels]);
  const listed = useMemo(() => new Set(myListIds), [myListIds]);

  // Placeholders filtered here rather than only in the stream browser: one
  // promoted before that filter existed is still in the lineup, and a
  // channel named "#####" is no more watchable from a row than it was from
  // the catalogue.
  //
  // Two more go the same way (2026-10-16), by the server's verdict: a channel
  // the checker has found dead three scans running, and a per-game event
  // slot whose game is over. Admins still see both, badged, so they can be
  // fixed or removed; nobody else should ever tune one.
  //
  // A channel that is not working (2026-10-24: liveChannelStateRules.ts,
  // from tunes that never reached a picture, or the checker's dead verdict)
  // stays in the lineup only for My Stations, greyed with "Not working right
  // now" -- a list someone built on purpose should not silently lose a
  // channel -- and is left out of everything that offers channels: the rows,
  // the guide and the Live now games.
  const lineup = useMemo(
    () =>
      channels.filter(
        (c) =>
          !looksLikePlaceholder(c.name) &&
          !hiddenIds.has(c.id) &&
          (isAdmin || !statusByChannel[c.name]?.hidden || isNotWorking(statusByChannel[c.name]))
      ),
    [channels, hiddenIds, isAdmin, statusByChannel]
  );
  const offered = useMemo(
    () => (isAdmin ? lineup : lineup.filter((c) => !isNotWorking(statusByChannel[c.name]))),
    [lineup, isAdmin, statusByChannel]
  );
  const gameChannels = useMemo(
    () => channels.filter((c) => !isNotWorking(statusByChannel[c.name])),
    [channels, statusByChannel]
  );

  // The three states are deliberately distinguished. "Jellyfin is unreachable",
  // "Jellyfin is fine but has no tuner", and "there's a tuner but it returned
  // nothing" have completely different fixes, and collapsing them into one
  // empty state is what makes a feature feel broken rather than unconfigured.
  let empty: { title: string; detail: React.ReactNode } | null = null;
  if (!envSet) {
    empty = {
      title: "Live TV isn’t configured",
      detail: (
        <>
          <code className="text-white/70">JELLYFIN_URL</code> or{" "}
          <code className="text-white/70">JELLYFIN_API_KEY</code> is unset on the server.
        </>
      ),
    };
  } else if (!reachable) {
    // Distinct from "no tuner" on purpose. Reporting a downed server as a
    // missing tuner sends you to check the wrong thing entirely.
    empty = {
      title: "Jellyfin isn’t responding",
      detail:
        "Streamy is configured for Jellyfin but the server isn’t answering. " +
        "Check that the Jellyfin container is running.",
    };
  } else if (channels.length === 0) {
    // Deliberately one state, not two. Telling "no tuner" apart from "tuner
    // that hasn't scanned" needs a signal Jellyfin doesn't cheaply expose, and
    // guessing at one is what produced a confidently wrong message before.
    empty = {
      title: "No channels",
      detail: (
        <>
          Jellyfin is running but returned no channels. Check that a tuner is added under{" "}
          <span className="text-white/70">Dashboard → Live TV → Tuner Devices</span>, and that
          it has finished scanning.
        </>
      ),
    };
  }

  const emptyPanel = empty && (
    <div className="rounded-lg border border-white/10 bg-netflix-dark/60 px-4 py-10 text-center">
      <p className="text-base font-semibold text-white/80">{empty.title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/50">{empty.detail}</p>
    </div>
  );

  const lookups: CardLookups = { infoByChannel, statusByChannel, logoFallbacks, providerStateByChannel };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 md:px-6">
      <h1 className={ROW_H2_CLASS}>Live TV</h1>
      <LiveTabBar active={tab} />

      {tab === "now" && (
        <>
          {/* The games row is independent of Jellyfin entirely, so it still
              renders above a broken lineup: someone landing here while Live
              TV is down should still see what's on. */}
          <LiveNowGames channels={gameChannels} initialFixtures={initialFixtures} />
          {emptyPanel ?? <NowTab lineup={lineup} offered={offered} listed={listed} {...lookups} />}
        </>
      )}

      {tab === "guide" &&
        (emptyPanel ?? (
          <GuideTab
            lineup={offered}
            listed={listed}
            truncated={truncated}
            total={channels.length}
            isAdmin={isAdmin}
            guidePrograms={guidePrograms}
            {...lookups}
          />
        ))}

      {/* Both rendered whether or not the lineup loaded: the schedule comes
          from ESPN and the recordings from Sportarr, neither of which needs
          Jellyfin's channels. */}
      {tab === "sports" && <SportsTab />}

      {tab === "recordings" && <RecordingsTab />}
    </div>
  );
}

function LiveTabBar({ active }: { active: LiveTab }) {
  return (
    <TabBar label="Live TV sections" className="mb-6">
      {LIVE_TABS.map((t) => (
        <TabLink key={t.key} href={liveTabHref(t.key)} active={t.key === active}>
          {t.label}
        </TabLink>
      ))}
    </TabBar>
  );
}

/**
 * Now: what to put on. My Stations first, then one row per league and genre.
 * No search, sort or filter -- those are the Guide's, and a row that can be
 * narrowed is a grid wearing a costume.
 */
function NowTab({
  lineup, offered, listed, infoByChannel, statusByChannel, logoFallbacks, providerStateByChannel,
}: { lineup: LiveChannel[]; offered: LiveChannel[]; listed: Set<string> } & CardLookups) {
  // Pinned above the rest. Starred channels are left out of the rows below
  // on purpose -- a channel already on its own shelf, shown a second time
  // further down, was the literal meaning of "duplicated on the page",
  // reported live.
  const mine = lineup.filter((c) => listed.has(c.id));
  const shelves = useMemo(
    () => groupIntoShelves([...offered].filter((c) => !listed.has(c.id)).sort((a, b) => a.name.localeCompare(b.name))),
    [offered, listed]
  );

  const card = (c: LiveChannel) => (
    <div key={c.id} className="w-72 shrink-0 snap-start">
      <ChannelCard
        channel={c}
        inList={listed.has(c.id)}
        info={infoByChannel[c.name]}
        status={statusByChannel[c.name]}
        logoFallback={logoFallbacks[c.name]}
        providerState={providerStateByChannel[c.name]}
      />
    </div>
  );

  return (
    <>
      {mine.length > 0 && (
        <section className="mb-8">
          <h2 className={ROW_H2_CLASS}>My Stations</h2>
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">{mine.map(card)}</div>
        </section>
      )}

      {/* One row per league, then per genre -- see liveShelves.ts. */}
      {shelves.map(({ shelf, channels: row }) => (
        <section key={shelf.key} className="mb-8">
          <h2 className={ROW_H2_CLASS}>
            {shelf.title} <span className="text-sm font-normal text-white/40">{row.length}</span>
          </h2>
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">{row.map(card)}</div>
        </section>
      ))}
    </>
  );
}

/**
 * Guide: a real TV guide -- channels down, half-hours across, programmes as
 * blocks sized by how long they run (see LiveGuideGrid). Still the only place
 * search, the category select and the sort select live; they narrow which
 * rows the grid draws.
 */
function GuideTab({
  lineup, listed, truncated, total, isAdmin, guidePrograms, infoByChannel, statusByChannel, logoFallbacks, providerStateByChannel,
}: {
  lineup: LiveChannel[];
  listed: Set<string>;
  truncated: boolean;
  total: number;
  isAdmin: boolean;
  guidePrograms: Record<string, GuideProgram[]>;
} & CardLookups) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<"name" | "number">("name");
  const [category, setCategory] = useState<string>("all");

  // Computed once over the whole lineup rather than per render of a card:
  // classifying 1,477 names on every keystroke is wasted work.
  const categoryById = useMemo(
    () => new Map(lineup.map((c) => [c.id, classifyChannel(c.name)])),
    [lineup]
  );

  // Only offer categories this lineup actually has, with counts. An empty
  // "Cartoons" option that filters to nothing is worse than no option.
  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of categoryById.values()) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...CHANNEL_CATEGORIES, "Other"]
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => ({ name: c, count: counts.get(c)! }));
  }, [categoryById]);

  const sorted = useMemo(() => {
    const arr = [...lineup];
    if (sortBy === "number") {
      arr.sort((a, b) => {
        const an = numberValue(a.number);
        const bn = numberValue(b.number);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        if (!Number.isNaN(an)) return -1;
        if (!Number.isNaN(bn)) return 1;
        return a.name.localeCompare(b.name);
      });
    } else {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return arr;
  }, [lineup, sortBy]);

  const inCategory = useMemo(
    () => sorted.filter((c) => category === "all" || categoryById.get(c.id) === category),
    [sorted, category, categoryById]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inCategory;
    // Number as well as name: on a broadcast lineup people reach for "7.1"
    // as readily as for the call sign.
    // And what is on: in a guide, "where's the game" is as natural a search
    // as a channel name.
    return inCategory.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.number ?? "").toLowerCase().includes(q) ||
        (c.now?.name ?? "").toLowerCase().includes(q) ||
        (guidePrograms[guideKey(c.name)] ?? []).some((p) => p.title.toLowerCase().includes(q))
    );
  }, [inCategory, query, guidePrograms]);

  const visible = filtered.slice(0, shown);

  // A grid of nothing but "No guide info" rows is a worse channel list than
  // the channel list, so with no listings for any channel at all (the EPG
  // fetch failed, or nothing is mapped) the Guide falls back to the cards it
  // used to be. One channel with listings is enough to make the grid worth it.
  const hasGuide = useMemo(
    () => lineup.some((c) => programsForChannel(c, guidePrograms).length > 0),
    [lineup, guidePrograms]
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Always shown, not gated on a channel count worth paging through:
            finding a specific channel by name is the same need at 23
            channels as at 600. */}
        <TextInput
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset paging here rather than in an effect: it is a consequence
            // of the edit, not of the render. Without it the reveal count from
            // the previous search carries over and results look arbitrarily
            // long.
            setShown(PAGE_SIZE);
          }}
          placeholder="Search channels or shows…"
          aria-label="Search channels"
          // text-base on mobile: iOS zooms the viewport on a focused input
          // under 16px and there is no way back out without pinching.
          className="min-w-0 flex-1 py-2 text-base sm:text-sm"
        />

        {availableCategories.length > 1 && (
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setShown(PAGE_SIZE);
            }}
            className="w-auto shrink-0 py-2"
            aria-label="Filter channels by type"
          >
            <option value="all">All types</option>
            {availableCategories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </Select>
        )}

        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "name" | "number")}
          className="w-auto shrink-0 py-2"
          aria-label="Sort channels"
        >
          <option value="name">Sort: Name</option>
          <option value="number">Sort: Channel #</option>
        </Select>

        <span className="text-sm text-white/40">
          {query ? `${filtered.length} of ${inCategory.length}` : `${inCategory.length} channel${inCategory.length === 1 ? "" : "s"}`}
          {truncated && !query ? "+" : ""}
        </span>

        {/* The one trace of management left on the viewing page: a way for
            the admin to get to it. Everyone else never sees it. */}
        {isAdmin && (
          <ButtonLink href="/admin/live-tv" variant="ghost" size="sm" className="ml-auto">
            Manage channels
          </ButtonLink>
        )}
      </div>

      {visible.length > 0 &&
        (hasGuide ? (
          <LiveGuideGrid
            channels={visible}
            guidePrograms={guidePrograms}
            statusByChannel={statusByChannel}
            logoFallbacks={logoFallbacks}
          />
        ) : (
          <>
            <p className="mb-3 text-xs text-white/40">No guide listings right now, so here are the channels.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((c) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  inList={listed.has(c.id)}
                  info={infoByChannel[c.name]}
                  status={statusByChannel[c.name]}
                  logoFallback={logoFallbacks[c.name]}
                  providerState={providerStateByChannel[c.name]}
                />
              ))}
            </div>
          </>
        ))}

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-white/40">
          {query ? <>No channels match “{query}”.</> : "No channels of this type."}
        </p>
      )}

      {shown < filtered.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
          </Button>
        </div>
      )}

      {truncated && !query && shown >= filtered.length && (
        // Said out loud rather than silently cutting the list off, which
        // is what the old hard cap did.
        <p className="mt-4 text-center text-xs text-white/30">
          Showing the first {total} channels. Your tuner reports more -
          narrow the playlist in Jellyfin if you need the rest.
        </p>
      )}
    </>
  );
}
