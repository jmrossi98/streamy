import {
  jellyfinTranscodeStreamUrl,
  jellyfinUpstreamStreamUrl,
  jellyfinHlsMasterUrl,
  jellyfinHlsResourceUrl,
  jellyfinSubtitleStreamUrl,
} from "./jellyfin";

// Headers that must survive the hop for video playback to behave: the browser
// relies on them for seeking (Range/Content-Range/Accept-Ranges), for knowing
// when the file ends (Content-Length), and for picking a decoder (Content-Type).
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "last-modified",
  "etag",
];

/**
 * Pipes an item's bytes from Jellyfin back through Streamy's own origin,
 * forwarding the browser's Range request so seeking and partial loads work
 * exactly as they would against Jellyfin directly. The response body is
 * streamed, not buffered, so a multi-GB movie doesn't sit in memory.
 */
export async function proxyJellyfinStream(
  itemId: string,
  request: Request,
  opts: { transcode?: boolean; startSeconds?: number; playSessionId?: string } = {}
): Promise<Response> {
  const range = request.headers.get("range");
  // Direct file by default; the transcoded stream is requested only as a
  // fallback for content the browser couldn't play (see the watch page).
  // startSeconds/playSessionId only mean anything for a transcode -- a
  // direct-play file is already fully seekable via Range, which `range` above
  // already handles.
  const upstreamUrl = opts.transcode
    ? jellyfinTranscodeStreamUrl(itemId, opts.startSeconds, opts.playSessionId)
    : jellyfinUpstreamStreamUrl(itemId);
  const upstream = await fetch(upstreamUrl, {
    headers: range ? { Range: range } : {},
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream stream unavailable", { status: 502 });
  }

  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Some clients refuse to seek unless the server advertises range support.
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");

  return new Response(upstream.body, { status: upstream.status, headers });
}

const HLS_PLAYLIST_CONTENT_TYPES = [
  "mpegurl", // covers application/vnd.apple.mpegurl and (audio|application)/x-mpegurl
];

/**
 * Proxies one HLS resource for a transcode session -- the master/variant
 * playlist, or a media segment -- reached via the hls/[...path] catch-all
 * routes. Segments are piped through unchanged. Playlists are rewritten
 * first: left alone, they'd either leak JELLYFIN_API_KEY straight to the
 * browser (Jellyfin embeds it in every URL it emits) or point at Jellyfin's
 * Tailscale-only address, which a viewer's browser can't route to and an
 * HTTPS page can't load anyway (mixed content) -- same reasons the plain
 * proxyJellyfinStream above exists. Every reference gets turned into a
 * relative path, so the browser's next request for it lands back on this
 * same route, which re-attaches the real api_key server-side.
 */
export async function proxyJellyfinHlsResource(
  itemId: string,
  jellyfinPath: string,
  proxyBasePath: string,
  request: Request
): Promise<Response> {
  const incoming = new URL(request.url);
  // The master playlist is the one request usePlayerEngine builds itself
  // (videoSrc: `${videoUrl}/hls/master.m3u8?session=...&t=...`) rather than
  // one Jellyfin already emitted -- so, unlike every other HLS resource here,
  // its query string is ours, not Jellyfin's, and forwarding it verbatim was
  // wrong: `session`/`t` aren't params Jellyfin recognizes (it wants
  // PlaySessionId/startTimeTicks), and the request was missing every
  // transcode param entirely -- videoCodec, audioCodec, maxWidth,
  // videoBitRate, audioBitRate, segmentContainer, and mediaSourceId, the last
  // of which this server version outright rejects the request without
  // (confirmed live: HTTP 400 "The mediaSourceId field is required"). Build
  // it properly via jellyfinHlsMasterUrl instead of the generic passthrough.
  // Everything else here (variant playlists, segments) *is* a reference
  // Jellyfin already emitted inside the master playlist's own body, rewritten
  // only to relative + re-keyed through us (see rewriteHlsReference) -- those
  // already carry the right params and should keep being forwarded as-is.
  const upstreamUrl =
    jellyfinPath === "master.m3u8"
      ? jellyfinHlsMasterUrl(
          itemId,
          Number(incoming.searchParams.get("t")) || undefined,
          incoming.searchParams.get("session") || undefined
        )
      : jellyfinHlsResourceUrl(itemId, jellyfinPath, new URLSearchParams(incoming.searchParams));
  const range = request.headers.get("range");
  const upstream = await fetch(upstreamUrl, {
    headers: range ? { Range: range } : {},
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream stream unavailable", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const isPlaylist =
    HLS_PLAYLIST_CONTENT_TYPES.some((t) => contentType.toLowerCase().includes(t)) || jellyfinPath.endsWith(".m3u8");

  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");

  if (!isPlaylist) {
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const text = await upstream.text();
  const rewritten = text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return rewriteHlsReference(trimmed, itemId, proxyBasePath);
    })
    .join("\n");
  // The rewritten body's byte length differs from upstream's -- let the
  // runtime compute Content-Length rather than forwarding the stale one.
  headers.delete("content-length");
  return new Response(rewritten, { status: upstream.status, headers });
}

/** Proxies one WebVTT subtitle track -- small text, no range/streaming needed. */
export async function proxyJellyfinSubtitle(
  itemId: string,
  mediaSourceId: string,
  index: number
): Promise<Response> {
  const upstream = await fetch(jellyfinSubtitleStreamUrl(itemId, mediaSourceId, index), { cache: "no-store" });
  if (!upstream.ok) {
    return new Response("Subtitle unavailable", { status: 502 });
  }
  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/vtt; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Exported for testing -- see proxyJellyfinHlsResource for why this exists. */
export function rewriteHlsReference(ref: string, itemId: string, proxyBasePath: string): string {
  let path = ref;
  let query = "";
  const qIdx = ref.indexOf("?");
  if (qIdx !== -1) {
    path = ref.slice(0, qIdx);
    query = ref.slice(qIdx + 1);
  }
  // An absolute Jellyfin URL -- keep only what comes after /Videos/{itemId}/.
  const marker = `/Videos/${itemId}/`;
  const markerIdx = path.indexOf(marker);
  path = markerIdx !== -1 ? path.slice(markerIdx + marker.length) : path.replace(/^\/+/, "");
  const params = new URLSearchParams(query);
  params.delete("api_key");
  params.delete("X-Emby-Token");
  const qs = params.toString();
  return `${proxyBasePath}/${path}${qs ? `?${qs}` : ""}`;
}
