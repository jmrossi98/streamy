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

// How long Jellyfin gets to start answering. Generous: a transcode's first
// response waits on ffmpeg spinning up. Only the wait for headers is bounded
// -- a two-hour movie body must never be cut off by it.
const UPSTREAM_HEADERS_TIMEOUT_MS = 30_000;

/**
 * The abort signal for one upstream fetch. It fires when:
 *
 *   - the viewer goes away (request.signal, which Next aborts when the
 *     browser's connection closes). Without this, closing the player left
 *     the upstream fetch -- and the Jellyfin transcode feeding it -- running
 *     with nobody on the other end until Jellyfin noticed on its own; or
 *   - Jellyfin has not produced response headers within the timeout, so a
 *     hung Jellyfin turns into a prompt 504 instead of a request that holds a
 *     socket open forever.
 *
 * Call headersArrived() once headers are in, to disarm the timeout; the
 * disconnect half stays live for the whole body.
 */
export function upstreamAbort(request: Request | null, headersMs = UPSTREAM_HEADERS_TIMEOUT_MS) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error("upstream timed out")), headersMs);
  const signal = request ? AbortSignal.any([request.signal, timeout.signal]) : timeout.signal;
  return { signal, headersArrived: () => clearTimeout(timer), timedOut: () => timeout.signal.aborted };
}

/** fetch() under upstreamAbort, mapping a failure to the right status. */
async function fetchUpstream(
  url: string,
  request: Request | null,
  init: RequestInit = {}
): Promise<{ upstream: Response; done: () => void } | { error: Response }> {
  const abort = upstreamAbort(request);
  try {
    const upstream = await fetch(url, { ...init, cache: "no-store", signal: abort.signal });
    return { upstream, done: abort.headersArrived };
  } catch {
    abort.headersArrived();
    return {
      error: abort.timedOut()
        ? new Response("Upstream timed out", { status: 504 })
        : new Response("Upstream stream unavailable", { status: 502 }),
    };
  }
}

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
  const got = await fetchUpstream(upstreamUrl, request, { headers: range ? { Range: range } : {} });
  if ("error" in got) return got.error;
  const { upstream } = got;
  got.done();

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
  request: Request,
  // Live TV only. A recorded title has exactly one media source and Jellyfin
  // accepts the item id in its place, which is why every other caller omits
  // this. A live channel does not: Jellyfin opens a *stream* for it and hands
  // back an id for that stream, and the transcode has to name that id rather
  // than the channel's.
  mediaSourceId?: string,
  // Master playlist only: which audio track to transcode (see playbackLanguage.ts).
  audioStreamIndex?: number | null
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
  // already carry the right params and should keep being forwarded as-is,
  // with one exception: a resumed title (or any transcode-seek restart)
  // passes `t`/startTimeTicks on the master request, and Jellyfin's own
  // segment/variant URLs echo it back into every reference they contain --
  // but the per-segment endpoint (GetHlsVideoSegment) then rejects that exact
  // same param outright: "System.ArgumentException: StartTimeTicks is not
  // allowed", a 400 confirmed live against Jellyfin's own logs. Jellyfin only
  // wants startTimeTicks on the initial master request, never on what it
  // itself tells the player to fetch next -- strip it back out here.
  const forwardedParams = new URLSearchParams(incoming.searchParams);
  forwardedParams.delete("startTimeTicks");
  const upstreamUrl =
    jellyfinPath === "master.m3u8"
      ? jellyfinHlsMasterUrl(
          itemId,
          incoming.searchParams.get("session") || undefined,
          mediaSourceId,
          audioStreamIndex
        )
      : jellyfinHlsResourceUrl(itemId, jellyfinPath, forwardedParams);
  const range = request.headers.get("range");
  const got = await fetchUpstream(upstreamUrl, request, { headers: range ? { Range: range } : {} });
  if ("error" in got) return got.error;
  const { upstream } = got;

  if (!upstream.ok && upstream.status !== 206) {
    got.done();
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
    got.done();
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // A playlist is small: keep the timeout armed until its body is in too.
  let text: string;
  try {
    text = await upstream.text();
  } catch {
    return new Response("Upstream timed out", { status: 504 });
  } finally {
    got.done();
  }
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
  const got = await fetchUpstream(jellyfinSubtitleStreamUrl(itemId, mediaSourceId, index), null);
  if ("error" in got) return got.error;
  const { upstream } = got;
  let body: string;
  try {
    if (!upstream.ok) return new Response("Subtitle unavailable", { status: 502 });
    body = await upstream.text();
  } catch {
    return new Response("Subtitle unavailable", { status: 502 });
  } finally {
    got.done();
  }
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
