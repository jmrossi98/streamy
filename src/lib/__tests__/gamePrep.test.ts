import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The prep pass end to end, with Dispatcharr, ESPN, the probe and the database
 * replaced: Ana's Sharks game on 2026-11-12, and the cases that must leave the
 * lineup alone.
 */
const world = vi.hoisted(() => ({
  visits: [] as { userId: string; fixtureId: string; league: string; homeTeam: string | null; awayTeam: string | null; visitedAt: Date }[],
  picks: [] as { userId: string; fixtureId: string; pickedAt: Date }[],
  gameChannels: [] as { fixtureId: string; name: string }[],
  links: [] as { fixtureId: string; name: string }[],
  fixtures: [] as unknown[],
  lineup: [] as { name: string }[],
  candidates: [] as { id: number; name: string; provider: string | null; logoUrl: string | null; score: number | null; dated: boolean }[],
  probe: {} as Record<number, { status: string; video?: boolean; bytes?: number; mbps?: number; reason?: string }>,
  probed: [] as number[],
  promoted: [] as unknown[],
  connections: [] as { lineId: number | null }[],
  teamsLookedUp: [] as string[],
}));

const inWhere = (row: Record<string, unknown>, where: Record<string, unknown> | undefined) =>
  Object.entries(where ?? {}).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === "object" && "in" in (cond as object)) return ((cond as { in: unknown[] }).in).includes(v);
    if (cond && typeof cond === "object" && "gte" in (cond as object)) return (v as Date) >= (cond as { gte: Date }).gte;
    if (cond && typeof cond === "object" && "lt" in (cond as object)) return (v as Date) < (cond as { lt: Date }).lt;
    return v === cond;
  });

vi.mock("../db", () => ({
  prisma: {
    gameVisit: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => world.visits.filter((r) => inWhere(r, where)),
      deleteMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        world.visits = world.visits.filter((r) => !inWhere(r, where));
        return { count: 0 };
      },
      create: async ({ data }: { data: (typeof world.visits)[number] }) => {
        world.visits.push(data);
        return data;
      },
      upsert: async () => ({}),
    },
    gameChannelChoice: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => world.picks.filter((r) => inWhere(r, where)),
    },
    gameChannel: { findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => world.gameChannels.filter((r) => inWhere(r, where)) },
    gameChannelLink: { findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => world.links.filter((r) => inWhere(r, where)) },
  },
}));
vi.mock("../sportsSchedule", () => ({
  getTodaysFixtures: async () => world.fixtures,
  fetchFixtureTeams: async (id: string) => {
    world.teamsLookedUp.push(id);
    return { league: "NHL", homeTeam: "San Jose Sharks", awayTeam: `Opponent ${id}` };
  },
}));
vi.mock("../gameStreamCandidates", () => ({ listGameStreamCandidates: async () => world.candidates }));
vi.mock("../streamProbe", () => ({
  isStreamProbeConfigured: () => true,
  probeStream: async (id: number) => {
    world.probed.push(id);
    return world.probe[id] ?? { status: "error", reason: "unknown" };
  },
}));
vi.mock("../promoteStream", () => ({
  promoteStream: async (input: unknown) => {
    world.promoted.push(input);
    return { status: 200, body: { jellyfinId: "jf-1", existing: false } };
  },
  listedOrRefresh: async () => null,
}));
vi.mock("../liveTv", () => ({ getLiveChannels: async () => world.lineup }));
vi.mock("../dispatcharr", () => ({
  isDispatcharrConfigured: () => true,
  listIptvAccounts: async () => [
    { name: "trex", lines: [{ id: 1, viewers: 0 }, { id: 2, viewers: 0 }] },
    { name: "strong8k", lines: [{ id: 3, viewers: 0 }] },
  ],
  liveConnections: async () => world.connections,
}));

const NOW = new Date("2026-11-12T04:20:00Z");
const DAY = 86_400_000;
const sharks = {
  id: "NHL:401892695",
  league: "NHL",
  name: "Pittsburgh Penguins at San Jose Sharks",
  state: "in",
  startUtc: "2026-11-12T03:00:00Z",
  homeTeam: "San Jose Sharks",
  awayTeam: "Pittsburgh Penguins",
  detail: "2nd",
  broadcasts: ["ESPN+", "NBC Sports BA"],
};

async function run() {
  const { runGamePrep } = await import("../gamePrep");
  return runGamePrep(NOW);
}

beforeEach(() => {
  vi.resetModules();
  world.visits = [
    { userId: "ana", fixtureId: "NHL:401892669", league: "NHL", homeTeam: "Dallas Stars", awayTeam: "San Jose Sharks", visitedAt: new Date(NOW.getTime() - 5 * DAY) },
    { userId: "ana", fixtureId: "NHL:401892595", league: "NHL", homeTeam: "San Jose Sharks", awayTeam: "Buffalo Sabres", visitedAt: new Date(NOW.getTime() - 15 * DAY) },
  ];
  world.picks = [];
  world.gameChannels = [];
  world.links = [];
  world.fixtures = [sharks];
  world.lineup = [{ name: "NBC Sports Bay Area" }];
  world.candidates = [
    { id: 96218, name: "US (ESPN+ 166) | Pittsburgh Penguins vs. San Jose Sharks", provider: "trex", logoUrl: null, score: 0, dated: false },
    { id: 94032, name: "NHL | 06 - 10pm Penguins @ Sharks", provider: "strong8k", logoUrl: "logo.png", score: 0, dated: false },
    { id: 50000, name: "NHL NETWORK HD", provider: "trex", logoUrl: null, score: null, dated: false },
  ];
  world.probe = {
    96218: { status: "dead", video: false, bytes: 91, mbps: 0, reason: "no video" },
    94032: { status: "ok", video: true, bytes: 9_000_000, mbps: 7.1 },
  };
  world.probed = [];
  world.promoted = [];
  world.connections = [];
  world.teamsLookedUp = [];
});

describe("runGamePrep", () => {
  it("adds the first of a followed team's feeds that plays, before anyone opens the page", async () => {
    const report = await run();
    expect(report.followed).toEqual(["nhl|san jose sharks"]);
    expect(world.probed).toEqual([96218, 94032]);
    expect(world.promoted).toEqual([
      { streamId: 94032, name: "NHL | 06 - 10pm Penguins @ Sharks", logoUrl: "logo.png", fixtureId: sharks.id, auto: true },
    ]);
    expect(report.games).toEqual([{ fixtureId: sharks.id, name: sharks.name, action: "added", detail: "NHL | 06 - 10pm Penguins @ Sharks" }]);
  });

  it("leaves a game alone once a feed added for it is in the lineup", async () => {
    world.gameChannels = [{ fixtureId: sharks.id, name: "NHL | 06 - 10pm Penguins @ Sharks" }];
    world.lineup = [{ name: "NHL | 06 - 10pm Penguins @ Sharks" }];
    const report = await run();
    expect(report.games[0]).toMatchObject({ action: "ready" });
    expect(world.probed).toEqual([]);
    expect(world.promoted).toEqual([]);
  });

  it("checks nothing on a provider someone is watching", async () => {
    world.connections = [{ lineId: 3 }]; // strong8k's only line
    world.probe[96218] = { status: "dead", video: false };
    const report = await run();
    expect(world.probed).toEqual([96218]);
    expect(world.promoted).toEqual([]);
    expect(report.games[0]).toMatchObject({ action: "nothing-plays-yet" });
  });

  it("does nothing for a team nobody follows", async () => {
    world.visits = world.visits.slice(0, 1);
    const report = await run();
    expect(report.skipped).toBe("no followed teams yet");
    expect(world.probed).toEqual([]);
  });

  it("learns followed teams from picks made before visits were recorded", async () => {
    world.visits = [];
    world.picks = [
      { userId: "ana", fixtureId: "NHL:401892525", pickedAt: new Date(NOW.getTime() - 26 * DAY) },
      { userId: "ana", fixtureId: "NHL:401892595", pickedAt: new Date(NOW.getTime() - 15 * DAY) },
    ];
    const report = await run();
    expect(world.teamsLookedUp).toEqual(["NHL:401892525", "NHL:401892595"]);
    expect(report.backfilled).toBe(2);
    expect(report.followed).toEqual(["nhl|san jose sharks"]);
    expect(world.promoted).toHaveLength(1);
  });
});
