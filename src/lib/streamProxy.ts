import { jellyfinUpstreamStreamUrl } from "./jellyfin";

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
export async function proxyJellyfinStream(itemId: string, request: Request): Promise<Response> {
  const range = request.headers.get("range");
  const upstream = await fetch(jellyfinUpstreamStreamUrl(itemId), {
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
