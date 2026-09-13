import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { channelImageUpstreamUrl, isJellyfinReachable } from "@/lib/liveTv";

/**
 * Channel logo proxy.
 *
 * Exists for the same reason playback is proxied (see lib/jellyfin.ts):
 * JELLYFIN_URL is a Tailscale-only plain-HTTP address, so a viewer's browser
 * can't route to it and an HTTPS page couldn't load an HTTP image from it
 * anyway. Proxying also keeps JELLYFIN_API_KEY server-side rather than in an
 * <img src> the client can read.
 *
 * Signed-in viewers only -- not admin-only like the Games panel, since Live TV
 * is meant to be watchable by the household, but not open to the internet
 * either.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isJellyfinReachable()) {
    return NextResponse.json({ error: "Jellyfin not configured" }, { status: 503 });
  }

  const { channelId } = await params;
  const tag = new URL(request.url).searchParams.get("tag");
  if (!tag) {
    return NextResponse.json({ error: "Missing tag" }, { status: 400 });
  }

  try {
    const upstream = await fetch(channelImageUpstreamUrl(channelId, tag), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Image unavailable" }, { status: 404 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
        // The tag is a content hash, so a given URL's bytes never change --
        // safe to cache hard, and channel logos are requested on every render
        // of the grid.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  }
}
