import { describe, expect, it } from "vitest";
import {
  addressPlace,
  describeJellyfinSession,
  headroom,
  remoteJellyfinMbps,
  uploadBudgetMbps,
  DEFAULT_UPLOAD_BUDGET_MBPS,
} from "./streamingHeadroomRules";

describe("headroom", () => {
  it("adds the parts up against the line", () => {
    const h = headroom(
      [
        { label: "Streamy viewers", mbps: 16.4, kind: "streams" },
        { label: "Torrent seeding", mbps: 20.01, kind: "torrent" },
      ],
      96
    );
    expect(h.usedMbps).toBe(36.4);
    expect(h.freeMbps).toBe(59.6);
    expect(h.usedPct).toBe(38);
    expect(h.level).toBe("ok");
    expect(h.parts[1].mbps).toBe(20);
  });

  it("grades the line", () => {
    const one = (mbps: number) => headroom([{ label: "x", mbps, kind: "streams" }], 100).level;
    expect(one(59)).toBe("ok");
    expect(one(60)).toBe("tight");
    expect(one(85)).toBe("saturated");
    expect(one(140)).toBe("saturated");
  });

  it("never reports negative headroom", () => {
    expect(headroom([{ label: "x", mbps: 150, kind: "streams" }], 96).freeMbps).toBe(0);
  });

  it("reads the budget from the environment, defaulting to the measured line", () => {
    expect(uploadBudgetMbps("250")).toBe(250);
    expect(uploadBudgetMbps(undefined)).toBe(DEFAULT_UPLOAD_BUDGET_MBPS);
    expect(uploadBudgetMbps("fast")).toBe(DEFAULT_UPLOAD_BUDGET_MBPS);
    expect(uploadBudgetMbps("0")).toBe(DEFAULT_UPLOAD_BUDGET_MBPS);
  });
});

describe("addressPlace", () => {
  it("tells the house, the tailnet and the outside apart", () => {
    expect(addressPlace("192.168.0.244")).toBe("lan");
    expect(addressPlace("::ffff:10.0.0.5")).toBe("lan");
    expect(addressPlace("172.18.0.3")).toBe("lan");
    expect(addressPlace("127.0.0.1")).toBe("lan");
    expect(addressPlace("100.84.77.56")).toBe("tailnet");
    expect(addressPlace("100.200.1.1")).toBe("remote"); // outside the CGNAT range Tailscale uses
    expect(addressPlace("68.1.2.3")).toBe("remote");
    expect(addressPlace("2601:abc::1")).toBe("remote");
    expect(addressPlace(undefined)).toBe("unknown");
  });
});

describe("describeJellyfinSession", () => {
  it("ignores a session that isn't playing", () => {
    expect(describeJellyfinSession({ UserName: "jaker", NowPlayingItem: null })).toBeNull();
  });

  it("describes a remote transcode", () => {
    const d = describeJellyfinSession({
      Id: "s1",
      UserName: "mom",
      Client: "Jellyfin Web",
      DeviceName: "Chrome",
      RemoteEndPoint: "73.1.2.3",
      NowPlayingItem: { Name: "Pilot", SeriesName: "Frieren", Type: "Episode", MediaSources: [{ Bitrate: 42_000_000 }] },
      PlayState: { PlayMethod: "Transcode", IsPaused: false },
      TranscodingInfo: { Bitrate: 8_000_000, IsVideoDirect: false, VideoCodec: "h264", Width: 1920, Height: 1080, TranscodeReasons: ["VideoCodecNotSupported"] },
    });
    expect(d).toMatchObject({
      user: "mom",
      title: "Frieren · Pilot",
      where: "remote",
      method: "transcode",
      mbps: 8,
      output: "1920x1080 h264",
      reasons: ["VideoCodecNotSupported"],
    });
  });

  it("describes a LAN direct play by the file's bitrate and labels live channels", () => {
    const d = describeJellyfinSession({
      UserName: "jaker",
      Client: "Roku",
      RemoteEndPoint: "192.168.0.50",
      NowPlayingItem: { Name: "CBS 8", Type: "TvChannel", MediaSources: [{ Bitrate: 6_500_000 }] },
      PlayState: { PlayMethod: "DirectPlay" },
    });
    expect(d).toMatchObject({ title: "Live: CBS 8", where: "lan", method: "direct", mbps: 6.5 });
  });

  it("calls a copied video stream a remux", () => {
    const d = describeJellyfinSession({
      NowPlayingItem: { Name: "Film" },
      PlayState: { PlayMethod: "Transcode" },
      TranscodingInfo: { IsVideoDirect: true, Bitrate: 12_000_000 },
    });
    expect(d?.method).toBe("remux");
  });
});

describe("remoteJellyfinMbps", () => {
  it("counts only unpaused sessions from outside the house", () => {
    const base = { id: "", user: "", client: "", device: "", title: "", ip: null, method: "direct" as const, reasons: [], output: null };
    expect(
      remoteJellyfinMbps([
        { ...base, where: "remote", mbps: 10, paused: false },
        { ...base, where: "remote", mbps: 10, paused: true },
        { ...base, where: "lan", mbps: 40, paused: false },
        { ...base, where: "tailnet", mbps: 8, paused: false },
        { ...base, where: "remote", mbps: null, paused: false },
      ])
    ).toBe(10);
  });
});
