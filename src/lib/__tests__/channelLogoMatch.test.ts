import { describe, expect, it } from "vitest";
import { borrowLogo, networkKey } from "../channelLogoMatch";

/**
 * Names here are the real lineup, not invented ones. Every channel already
 * carries a logo_id; the pictures are missing because one picon host answered
 * 503 for everything and another did not resolve, from both Lightsail and
 * mediabox. So these cover the fallback that has to work while the upstream
 * is gone.
 */
describe("networkKey", () => {
  it("strips the provider's market prefixes", () => {
    expect(networkKey("US: NBC SPORTS NOW")).toBe(networkKey("NBC SPORTS NOW"));
    expect(networkKey("USA - ABC 7 BUFFALO NY")).toBe(networkKey("ABC 7 BUFFALO NY"));
    expect(networkKey("SP - NBA TV HD")).toBe(networkKey("NBA TV"));
  });

  it("strips quality markers, including the superscript ones", () => {
    // ᴴᴰ and ᴿᴬᵂ are single codepoints, not the ASCII letters they resemble,
    // so they survive an [a-z] filter and would otherwise keep two spellings
    // of one channel apart.
    expect(networkKey("NBA: NEW YORK KNICKS (NYK) ᴴᴰ")).toBe(
      networkKey("NBA: NEW YORK KNICKS")
    );
    expect(networkKey("US: PEACOCK ORIGINAL 1 ᴿᴬᵂ")).toBe(
      networkKey("PEACOCK ORIGINAL 1")
    );
  });

  it("drops parenthesised call signs, which are per-station not per-network", () => {
    expect(networkKey("USA - CBS 13 BALTIMORE MD (WJZ)")).toBe(
      networkKey("CBS 13 BALTIMORE MD")
    );
  });

  it("keeps a network whose real name starts with a league word", () => {
    // "NFL - NFL NETWORK HD" loses only the prefix; the channel is still
    // NFL Network, and stripping both would leave "network".
    expect(networkKey("NFL - NFL NETWORK HD")).toBe("nflnetwork");
  });

  it("strips a bare league word only when a real name remains", () => {
    // "NHL SAN JOSE SHARKS" has no separator after the league word, so it
    // needs stripping for the team to match its other feeds -- but the same
    // rule applied to "NFL NETWORK" would leave "network", which would then
    // match any other network. Two words is the line.
    expect(networkKey("NHL SAN JOSE SHARKS")).toBe(networkKey("US: SAN JOSE SHARKS"));
    expect(networkKey("NHL BUFFALO SABRES")).toBe("buffalosabres");
    expect(networkKey("NFL NETWORK")).toBe("nflnetwork");
  });

  it("returns empty for a name that is only decoration", () => {
    // Must not become a key that other empty names match against.
    expect(networkKey("HD")).toBe("");
    expect(networkKey("US:")).toBe("");
  });

  it("keeps genuinely different networks apart", () => {
    expect(networkKey("SP - NHL NETWORK HD")).not.toBe(networkKey("NHL BUFFALO SABRES"));
    expect(networkKey("NBA TV")).not.toBe(networkKey("NBA: NEW YORK KNICKS"));
  });
});

describe("borrowLogo", () => {
  const lineup = [
    { name: "NBA TV", logoUrl: "/logo/nbatv.png" },
    { name: "NHL BUFFALO SABRES", logoUrl: "/logo/sabres.png" },
    { name: "SP - NHL NETWORK HD", logoUrl: "" },
    { name: "US: SAN JOSE SHARKS", logoUrl: "/logo/nhl.png" },
  ];

  it("borrows from the same network under a different name", () => {
    // The exact case in the screenshot: "SP - NBA TV HD" is grey while
    // "NBA TV" has a working image. A logo is a network's mark, so this is
    // accurate rather than a guess.
    expect(borrowLogo("SP - NBA TV HD", lineup)).toBe("/logo/nbatv.png");
  });

  it("never borrows across networks that merely share a league word", () => {
    // "SP - NHL NETWORK HD" must not end up wearing the Sabres badge.
    expect(borrowLogo("SP - NHL NETWORK HD", lineup)).toBeNull();
  });

  it("ignores candidates that have no logo themselves", () => {
    expect(borrowLogo("NHL NETWORK", lineup)).toBeNull();
  });

  it("does not borrow from itself", () => {
    expect(borrowLogo("NBA TV", lineup)).toBeNull();
  });

  it("is deterministic when several siblings qualify", () => {
    // Otherwise a channel changes logo between page loads, which reads as a
    // bug even though both are correct.
    const many = [
      { name: "US: SAN JOSE SHARKS", logoUrl: "/logo/b.png" },
      { name: "NHL SAN JOSE SHARKS", logoUrl: "/logo/a.png" },
    ];
    const first = borrowLogo("SAN JOSE SHARKS ᴴᴰ", many);
    expect(first).toBe("/logo/a.png");
    expect(borrowLogo("SAN JOSE SHARKS ᴴᴰ", [...many].reverse())).toBe(first);
  });

  it("returns null for a name with no usable key", () => {
    expect(borrowLogo("HD", lineup)).toBeNull();
  });
});
