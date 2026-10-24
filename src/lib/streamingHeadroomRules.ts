/**
 * The rules behind the admin Streaming tab's headroom gauge. Pure.
 *
 * Every Streamy stream leaves the house over the home upload line: Jellyfin on
 * mediabox -> Tailscale -> the Lightsail proxy -> viewer, even when the viewer
 * is on the couch. Measured 2026-10-18: the line carries ~96 Mbit/s up, a
 * 1080p transcode is ~8, a 4K direct play 40-60, and qBittorrent seeds ~20
 * around the clock. So the question "can a fourth person start a film" is a
 * question about this one number, not about mediabox's CPU.
 */

/** Cox upload, Mbit/s, as measured on 2026-10-18. Overridable per deployment. */
export const DEFAULT_UPLOAD_BUDGET_MBPS = 96;

export type HeadroomLevel = "ok" | "tight" | "saturated";

export type HeadroomPart = {
  label: string;
  mbps: number;
  kind: "streams" | "jellyfin" | "torrent";
};

export type Headroom = {
  budgetMbps: number;
  usedMbps: number;
  freeMbps: number;
  usedPct: number;
  level: HeadroomLevel;
  parts: HeadroomPart[];
};

/** Above these shares of the line, a new 8 Mbit/s viewer starts to be a gamble. */
export const TIGHT_PCT = 60;
export const SATURATED_PCT = 85;

export function headroom(parts: HeadroomPart[], budgetMbps = DEFAULT_UPLOAD_BUDGET_MBPS): Headroom {
  const used = parts.reduce((a, p) => a + Math.max(0, p.mbps), 0);
  const usedPct = budgetMbps > 0 ? (used / budgetMbps) * 100 : 100;
  return {
    budgetMbps,
    usedMbps: round1(used),
    freeMbps: round1(Math.max(0, budgetMbps - used)),
    usedPct: Math.round(usedPct),
    level: usedPct >= SATURATED_PCT ? "saturated" : usedPct >= TIGHT_PCT ? "tight" : "ok",
    parts: parts.map((p) => ({ ...p, mbps: round1(p.mbps) })),
  };
}

/** Reads a deployment's budget from the environment, falling back to the measured default. */
export function uploadBudgetMbps(env: string | undefined): number {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPLOAD_BUDGET_MBPS;
}

export type AddressPlace = "lan" | "tailnet" | "remote" | "unknown";

/**
 * Where a Jellyfin session is, from the address Jellyfin saw.
 *
 * LAN viewers (Roku, the Jellyfin app at home) don't touch the upload line.
 * Tailnet addresses are the Lightsail proxy, i.e. Streamy's own viewers,
 * which the meter already counts byte for byte. Anything else reached
 * Jellyfin from outside, through the Cloudflare tunnel, and does use the line.
 */
export function addressPlace(ip: string | null | undefined): AddressPlace {
  if (!ip) return "unknown";
  const v4 = ip.replace(/^::ffff:/, "");
  if (v4 === "127.0.0.1" || ip === "::1") return "lan";
  if (/^192\.168\./.test(v4) || /^10\./.test(v4) || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return "lan";
  if (/^fe80:/i.test(ip) || /^fd/i.test(ip)) return "lan";
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v4)) return "tailnet";
  return "remote";
}

export type JellyfinSessionLike = {
  Id?: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  RemoteEndPoint?: string;
  /** When the player last reported progress, ISO. */
  LastPlaybackCheckIn?: string;
  NowPlayingItem?: {
    Name?: string;
    SeriesName?: string;
    Type?: string;
    MediaSources?: { Bitrate?: number }[];
  } | null;
  PlayState?: { PlayMethod?: string; IsPaused?: boolean; PositionTicks?: number } | null;
  TranscodingInfo?: {
    Bitrate?: number;
    Framerate?: number;
    HardwareAccelerationType?: string;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    VideoCodec?: string;
    Width?: number;
    Height?: number;
    TranscodeReasons?: string[];
  } | null;
};

export type DescribedSession = {
  id: string;
  user: string;
  client: string;
  device: string;
  title: string;
  /** A Live TV channel, by the name Dispatcharr publishes it under; null for a film or episode. */
  channel: string | null;
  where: AddressPlace;
  ip: string | null;
  /** direct | remux (video copied, container or audio changed) | transcode */
  method: "direct" | "remux" | "transcode";
  /** Megabits per second, from the transcode target or the file, or null when Jellyfin doesn't say. */
  mbps: number | null;
  paused: boolean;
  reasons: string[];
  /** "1920x1080 hevc" for a transcode. */
  output: string | null;
  /** The transcoder's output frame rate, when transcoding and Jellyfin says. */
  fps: number | null;
  /** "nvenc", "vaapi"... for a transcode. */
  hwAccel: string | null;
  /** Seconds since the player last reported progress to Jellyfin, when known. */
  checkInAgeS: number | null;
};

/** One Jellyfin session as a row for the admin, or null when it isn't playing anything. */
export function describeJellyfinSession(s: JellyfinSessionLike, now = Date.now()): DescribedSession | null {
  const item = s.NowPlayingItem;
  if (!item) return null;
  const t = s.TranscodingInfo;
  const playMethod = s.PlayState?.PlayMethod;
  const method: DescribedSession["method"] =
    playMethod === "DirectPlay" || playMethod === "DirectStream" ? "direct"
      : t && t.IsVideoDirect ? "remux"
      : t || playMethod === "Transcode" ? "transcode"
      : "direct";
  const bps = t?.Bitrate ?? item.MediaSources?.[0]?.Bitrate ?? null;
  const name = item.Name ?? "Unknown";
  const live = item.Type === "TvChannel";
  const title = live ? `Live: ${name}` : item.SeriesName ? `${item.SeriesName} · ${name}` : name;
  const checkIn = s.LastPlaybackCheckIn ? Date.parse(s.LastPlaybackCheckIn) : NaN;
  return {
    id: s.Id ?? `${s.UserName}-${s.DeviceName}`,
    user: s.UserName ?? "unknown",
    client: s.Client ?? "",
    device: s.DeviceName ?? "",
    title,
    channel: live ? name : null,
    where: addressPlace(s.RemoteEndPoint),
    ip: s.RemoteEndPoint ?? null,
    method,
    mbps: bps != null && bps > 0 ? round1(bps / 1e6) : null,
    paused: Boolean(s.PlayState?.IsPaused),
    reasons: t?.TranscodeReasons ?? [],
    output: t && t.Width && t.Height ? `${t.Width}x${t.Height}${t.VideoCodec ? ` ${t.VideoCodec}` : ""}` : null,
    fps: t && typeof t.Framerate === "number" && t.Framerate > 0 ? Math.round(t.Framerate) : null,
    hwAccel: t?.HardwareAccelerationType || null,
    // Jellyfin's clock, not the player's; a check-in "in the future" is clock skew, i.e. just now.
    checkInAgeS: Number.isFinite(checkIn) ? Math.max(0, Math.round((now - checkIn) / 1000)) : null,
  };
}

/** The upload line's share taken by Jellyfin sessions outside the house that Streamy isn't already metering. */
export function remoteJellyfinMbps(sessions: DescribedSession[]): number {
  return round1(sessions.filter((s) => s.where === "remote" && !s.paused).reduce((a, s) => a + (s.mbps ?? 0), 0));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
