import { describe, it, expect } from "vitest";
import { isFamilyFriendly, isPlayableHere, pickGameSwf, toFlashpointGame } from "../flashpoint";

// Shaped from a real response (verified live 2026-09-13 against
// db-api.unstable.life), not from the docs -- the docs are a TODO in their repo.
const REAL = {
  id: "000e582d-5638-4220-8c6e-cab655ec51ed",
  library: "arcade",
  title: "Mario Destroyer",
  alternateTitles: "",
  series: "",
  developer: "",
  publisher: "Play Toon Games",
  source: "playmariogames.com",
  tags: ["Action", "Super Mario", "Vertically-Scrolling Shooter", "Top-Down", "Auto-zipped"],
  platform: "Flash",
  playMode: "Single Player",
  status: "Playable",
  version: "",
  releaseDate: "",
  language: "en",
  notes: "",
  originalDescription: "Mario now pilots a spacecraft to finally put an end to the hated enemies.",
  zipped: true,
};

describe("toFlashpointGame", () => {
  it("maps a real search hit", () => {
    const g = toFlashpointGame(REAL)!;
    expect(g.id).toBe(REAL.id);
    expect(g.title).toBe("Mario Destroyer");
    expect(g.publisher).toBe("Play Toon Games");
    expect(g.platform).toBe("Flash");
    expect(g.status).toBe("Playable");
    expect(g.description).toContain("spacecraft");
    expect(g.tags).toContain("Super Mario");
  });

  // Most entries are missing most optional fields -- empty developer and
  // releaseDate are the norm, not the exception. Dropping those rows would
  // throw away most of the archive.
  it("keeps an entry that is missing every optional field", () => {
    const g = toFlashpointGame({ id: "x", title: "Bare Entry" })!;
    expect(g).toMatchObject({
      title: "Bare Entry", developer: "", publisher: "",
      releaseDate: "", language: "", description: "", tags: [],
    });
  });

  it("drops an entry with no id or no title", () => {
    expect(toFlashpointGame({ title: "No id" })).toBeNull();
    expect(toFlashpointGame({ id: "no-title" })).toBeNull();
    expect(toFlashpointGame({})).toBeNull();
  });

  it("survives tags arriving as something other than an array of strings", () => {
    expect(toFlashpointGame({ id: "a", title: "T", tags: "Action" })!.tags).toEqual([]);
    expect(toFlashpointGame({ id: "a", title: "T", tags: null })!.tags).toEqual([]);
    expect(toFlashpointGame({ id: "a", title: "T", tags: ["ok", 7, null] })!.tags).toEqual(["ok"]);
  });

  it("reads the description from originalDescription", () => {
    expect(toFlashpointGame({ id: "a", title: "T", originalDescription: "Hello" })!.description)
      .toBe("Hello");
  });
});

describe("isPlayableHere", () => {
  // The archive covers Shockwave, Unity, HTML5 and more. Ruffle plays exactly
  // one of them, so everything else has to be filtered out before it reaches a
  // row that implies you can click it.
  it("accepts Flash and rejects every other platform", () => {
    const g = (platform: string) => toFlashpointGame({ id: "a", title: "T", platform })!;
    expect(isPlayableHere(g("Flash"))).toBe(true);
    for (const p of ["Shockwave", "Unity", "HTML5", "Java", "3D Groove GX", ""]) {
      expect(isPlayableHere(g(p))).toBe(false);
    }
  });

  it("is case-insensitive about the platform name", () => {
    const g = toFlashpointGame({ id: "a", title: "T", platform: "flash" })!;
    expect(isPlayableHere(g)).toBe(true);
  });
});

describe("isFamilyFriendly", () => {
  const g = (tags: string[], library = "arcade") =>
    toFlashpointGame({ id: "a", title: "T", tags, library })!;

  // Tag sets copied from real archive entries. Flashpoint preserves what the
  // Flash web actually had, so an unfiltered search on a household media
  // server surfaced pornography -- this is the filter that stops it.
  it("rejects the real tag sets adult entries carry", () => {
    expect(isFamilyFriendly(g(["Adult", "Sexual Content", "Loop", "Spam", "Nudity", "Porn"])))
      .toBe(false);
    expect(isFamilyFriendly(g(["Adult", "Nudity", "Poker"]))).toBe(false);
  });

  // "theatre" is Flashpoint's animation/video-loop library. It is Flash, it
  // loads in Ruffle, and it is not a game.
  it("rejects the theatre library even when nothing is adult-tagged", () => {
    expect(isFamilyFriendly(g(["Comedy", "Joke"], "theatre"))).toBe(false);
    expect(isFamilyFriendly(g(["Comedy", "Joke"], "Theatre"))).toBe(false);
  });

  it("accepts an ordinary arcade game", () => {
    expect(isFamilyFriendly(g(["Action", "Platformer", "Auto-zipped"]))).toBe(true);
    expect(isFamilyFriendly(g([]))).toBe(true);
  });

  it("matches adult tags regardless of case", () => {
    expect(isFamilyFriendly(g(["ADULT"]))).toBe(false);
    expect(isFamilyFriendly(g(["sexual content"]))).toBe(false);
  });

  // Defaults matter: an entry with no library field is a game, not a loop,
  // and must not be filtered out on a missing value.
  it("treats a missing library as arcade", () => {
    expect(isFamilyFriendly(toFlashpointGame({ id: "a", title: "T" })!)).toBe(true);
  });
});

describe("pickGameSwf", () => {
  const e = (path: string, size: number) => ({ path, size });

  // A GameZIP mirrors the original site's directory tree, so it routinely
  // carries loader shims, ad stubs and unrelated SWFs beside the game. Taking
  // the first one gets you a blank frame or an advert.
  it("prefers a SWF under content/ over packaging alongside it", () => {
    expect(pickGameSwf([
      e("readme.swf", 900),
      e("content/example.com/game.swf", 5_000_000),
    ])).toBe("content/example.com/game.swf");
  });

  it("skips loaders, preloaders and ad stubs by name", () => {
    expect(pickGameSwf([
      e("content/site/preloader.swf", 4_000),
      e("content/site/ads.swf", 2_000),
      e("content/site/main.swf", 3_000_000),
    ])).toBe("content/site/main.swf");
  });

  // A loader is tiny next to what it loads, so size is the tiebreak.
  it("takes the largest remaining candidate", () => {
    expect(pickGameSwf([
      e("content/a.swf", 1_000),
      e("content/b.swf", 9_000_000),
      e("content/c.swf", 50_000),
    ])).toBe("content/b.swf");
  });

  // Better the biggest of what exists than giving up on a game that is there.
  it("falls back rather than giving up when everything looks like packaging", () => {
    expect(pickGameSwf([e("content/loader.swf", 10), e("content/ads.swf", 900)]))
      .toBe("content/ads.swf");
  });

  it("returns null when the archive has no SWF at all", () => {
    expect(pickGameSwf([e("content/index.html", 500), e("content/game.dcr", 9_000)])).toBeNull();
    expect(pickGameSwf([])).toBeNull();
  });

  it("handles an archive with exactly one SWF", () => {
    expect(pickGameSwf([e("content/only.swf", 1)])).toBe("content/only.swf");
  });

  // Regression: Learn to Fly's real GameZIP (flashpointId
  // 11ee16a3-dadb-4d54-84dd-a3dcf124ee1d, fetched and inspected live on
  // 2026-09-16) holds four legitimate mirrors. Size alone picked the
  // Vietnamese regional rip -- bigger purely from extra bundled assets, not
  // any difference in the actual game -- over two portals (Kongregate, Armor
  // Games) whose whole business is hosting the stock, unmodified original.
  it("prefers a known portal mirror over a bigger regional one (Learn to Fly)", () => {
    const entries = [
      e("content/cache.armorgames.com/files/games/learn-to-fly-3789.swf", 892_238),
      e("content/chat.kongregate.com/gamez/0004/5630/live/Learn_to_fly_Final_3.52k.swf", 894_960),
      e("content/static.game24h.vn/upload/game/2010-04-17/1271468645_baihocbaydaudoi2.swf", 1_201_484),
      e("content/www.hackedarcadegames.com/swf/learntofly_hack9.swf", 724_479),
    ];
    expect(pickGameSwf(entries)).toBe(
      "content/chat.kongregate.com/gamez/0004/5630/live/Learn_to_fly_Final_3.52k.swf"
    );
  });

  // Regression, the other direction: Bloons TD 5's real GameZIP
  // (flashpointId 07921a2f-26fd-4364-9671-ee0c8d256ec1) has no portal mirror
  // at all -- only the official ninjakiwi.com asset (domain-locked, but
  // genuine) and a "hackedgames.biz" rip. The portal list must not fall back
  // to preferring "not the official host" in general, or it would silently
  // swap a user onto a build that may have altered gameplay. With nothing
  // trusted to prefer, this must fall through to the original size-based
  // pick, same as before this change.
  // Regression: Stick RPG's real GameZIP (flashpointId
  // bbd64607-aac2-4c3e-b701-fa6d1b5d2fb8) has the same domain-lock shape as
  // Bloons TD 5 -- an "official" studio CDN asset that only runs on its
  // original site -- but with a genuine third option Bloons TD 5 didn't have:
  // a mirror from Andkon Arcade, a legitimate multi-decade Flash aggregator,
  // not a cheat site and not the locked original.
  it("prefers Andkon's mirror over a bigger official-but-locked asset (Stick RPG)", () => {
    const entries = [
      e("content/andkon.com/arcade/adventureaction/stickrpg/andkon170.swf", 1_220_283),
      e("content/localflash/demo/76020_srpgdemo202c.swf", 1_537_727),
      e("content/www.arcadeprehacks.com/swf/stickrpgcompletehack.swf", 2_538_718),
      e("content/www.xgenstudios.com/srpgcomplete-v1.5-xgcc.swf", 6_754_146),
      e("content/www.xgenstudios.com/srpgcompletexgen.swf", 2_540_508),
    ];
    expect(pickGameSwf(entries)).toBe(
      "content/andkon.com/arcade/adventureaction/stickrpg/andkon170.swf"
    );
  });

  // Regression: Duck Life 4's real GameZIP (flashpointId
  // e41bbfa1-1de6-41e8-81ff-a1012d00143c, fetched and inspected live on
  // 2026-09-16) holds exactly two builds -- Armor Games' own, which is
  // domain-locked and showed the "play this on Armor Games" splash, and a
  // mirror ~16KB smaller that plays fine. Armor Games used to be on the
  // trusted-portal list, so it won on both portal preference and size, and
  // the locked build is what a viewer got.
  it("prefers an unlocked mirror over a site-locker's own build (Duck Life 4)", () => {
    const entries = [
      e("content/armorgames.com/DuckLife4/ducklife-4-13008.swf", 8_899_507),
      e("content/games.wixgames.co.uk/games/ducklife4/swf/game.swf", 8_883_728),
    ];
    expect(pickGameSwf(entries)).toBe(
      "content/games.wixgames.co.uk/games/ducklife4/swf/game.swf"
    );
  });

  // A locked build is at least the real game, and says plainly why it won't
  // run. A cheat rip runs and quietly isn't the game you clicked, so it ranks
  // below even the lock.
  it("prefers a locked official build over a cheat-site rip", () => {
    const entries = [
      e("content/www.xgenstudios.com/game.swf", 2_540_508),
      e("content/www.arcadeprehacks.com/swf/game-hacked.swf", 9_000_000),
    ];
    expect(pickGameSwf(entries)).toBe("content/www.xgenstudios.com/game.swf");
  });

  it("falls through to size when no candidate is from a known portal (Bloons TD 5)", () => {
    const entries = [
      e("content/assets.ninjakiwi.com/Games/gameswfs/btd5-dat.swf", 18_993_704),
      e("content/cache.hackedgames.biz/uploads/games/files/732/Q3H4WR6ZBW4Y.swf", 87_845),
      e(
        "content/cache.hackedgames.biz/uploads/games/files/hacked/swf-001/btd5-2014.swf",
        15_354_544
      ),
    ];
    expect(pickGameSwf(entries)).toBe(
      "content/assets.ninjakiwi.com/Games/gameswfs/btd5-dat.swf"
    );
  });
});

