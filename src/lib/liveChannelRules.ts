/**
 * Whether a live channel is worth tuning, and why not when it isn't.
 *
 * Pure policy, no imports -- same split as downloadHealthRules.ts, so the
 * matching and the verdicts can be tested without a network.
 *
 * ## The problem this exists for
 *
 * A channel named "NFL CBS BILLS GIANTS JETS NEW YORK NY" streams h264 with
 * audio whether or not a Bills game exists. Measured 2026-09-26: no NFL, NBA
 * or NHL game was in progress anywhere -- the Bills fixture was the following
 * afternoon -- and both that channel and "NHL BUFFALO SABRES" were serving
 * video happily, sharing one encoder profile. So "the stream plays" says
 * nothing about whether the event is on.
 *
 * Nor does looking at the picture. Both carried motion and sound, so
 * freezedetect and silencedetect found nothing; the filler is animated, not a
 * still slate. Those checks still earn their place -- the same sweep found
 * five genuinely dead channels out of twenty-five -- they just cannot answer
 * this question.
 *
 * What can answer it is the schedule, which sportsSchedule.ts already
 * fetches for the fixtures page. A channel that advertises a team is
 * trustworthy only while that team has a game in progress; outside that
 * window whatever it is playing is filler by definition, without needing to
 * identify what the filler is.
 *
 * The honest limit: this cannot tell you a live stream is showing the *wrong*
 * game. It catches filler, dead channels and dead air, which is what actually
 * goes wrong here.
 */

export type Team = {
  /** For reporting coverage, not for matching -- see the note on aliases. */
  league: string;
  /**
   * Matched case-insensitively against both channel names and the team names
   * on a fixture.
   *
   * Nicknames rather than cities, deliberately, and that choice also removes
   * the need to disambiguate by league. "NEW YORK" appears in the Knicks,
   * Jets and Giants channel names at once, so a city match would call a
   * Knicks channel live because the Jets are playing -- while "sabres" and
   * "bills" identify exactly one team each, even though Buffalo fields both.
   */
  aliases: string[];
};

/** Teams worth guaranteeing coverage for. */
export const TRACKED_TEAMS: Team[] = [
  { league: "NFL", aliases: ["bills"] },
  { league: "NFL", aliases: ["giants"] },
  { league: "NFL", aliases: ["jets"] },
  { league: "NFL", aliases: ["chiefs"] },
  { league: "NFL", aliases: ["ravens"] },
  { league: "NHL", aliases: ["sabres"] },
  { league: "NHL", aliases: ["sharks"] },
  { league: "NBA", aliases: ["knicks"] },
];

function matchesAlias(haystack: string, alias: string): boolean {
  return new RegExp(`\\b${alias}\\b`).test(haystack.toLowerCase());
}

/**
 * Teams a channel name claims to carry.
 *
 * A name may list several ("BILLS GIANTS JETS"), which is a regional slot
 * showing whichever of them is on. Any one being live makes the channel
 * plausible.
 */
export function teamsInChannelName(channelName: string): Team[] {
  return TRACKED_TEAMS.filter((t) => t.aliases.some((a) => matchesAlias(channelName, a)));
}

/** The shape this needs from sportsSchedule's Fixture, and no more. */
export type FixtureLike = {
  state: string;
  awayTeam: string | null;
  homeTeam: string | null;
};

/**
 * Tracked aliases that have a game actually in progress.
 *
 * Only `in` counts. A fixture that is `pre` has not started and one that is
 * `post` is over, and a channel advertising the team is filler in both cases
 * -- which is the entire question being asked.
 */
export function liveAliases(fixtures: FixtureLike[]): Set<string> {
  const live = new Set<string>();
  for (const f of fixtures) {
    if (f.state !== "in") continue;
    const sides = `${f.awayTeam ?? ""} ${f.homeTeam ?? ""}`;
    for (const team of TRACKED_TEAMS) {
      for (const alias of team.aliases) {
        if (matchesAlias(sides, alias)) live.add(alias);
      }
    }
  }
  return live;
}

export type StreamHealth = {
  /** Did the stream open and decode a video track at all? */
  playable: boolean;
  /** Video frozen for the whole sample -- a still slate. */
  frozen?: boolean;
  /** No audio above the noise floor for the whole sample. */
  silent?: boolean;
  detail?: string;
};

export type ChannelState = "live" | "no-event" | "filler" | "down" | "unknown";

export type ChannelVerdict = {
  state: ChannelState;
  /** Shown to a viewer, so it says what to expect rather than what was measured. */
  detail: string;
};

/**
 * Combines what the stream is doing with whether the event exists.
 *
 * Order matters: a channel that will not play is down whatever the schedule
 * says, and there is no point telling someone no game is on for a channel
 * they could not have watched anyway.
 */
export function channelVerdict(
  channelName: string,
  health: StreamHealth | null,
  live: Set<string> | null
): ChannelVerdict {
  if (!health) {
    return { state: "unknown", detail: "Not checked recently" };
  }
  if (!health.playable) {
    return { state: "down", detail: health.detail || "Channel is not responding" };
  }
  // A still picture with no sound is a slate regardless of what is scheduled,
  // and saying "no game on" for one would be a false statement about the
  // world -- there may well be a game this channel simply is not carrying.
  if (health.frozen && health.silent) {
    return { state: "filler", detail: "Playing a placeholder, not live content" };
  }

  const teams = teamsInChannelName(channelName);
  if (teams.length === 0) {
    // Not a team channel: a network feed carries what it carries, and there is
    // nothing to cross-reference it against.
    return { state: "live", detail: "Streaming" };
  }
  if (!live) {
    return { state: "unknown", detail: "Schedule unavailable" };
  }

  const playing = teams.filter((t) => t.aliases.some((a) => live.has(a)));
  if (playing.length > 0) {
    return { state: "live", detail: "Game in progress" };
  }
  return {
    state: "no-event",
    detail: `No ${teams.map((t) => t.aliases[0]).join("/")} game in progress -- expect filler`,
  };
}

/** Sort order for a channel list: what someone can actually watch, first. */
export const STATE_RANK: Record<ChannelState, number> = {
  live: 0,
  unknown: 1,
  "no-event": 2,
  filler: 3,
  down: 4,
};
