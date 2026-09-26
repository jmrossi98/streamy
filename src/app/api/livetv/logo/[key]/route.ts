import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readCachedLogo, sniffImageType } from "@/lib/channelLogoCache";

/**
 * Serves a cached channel logo.
 *
 * Separate from the Jellyfin image proxy next door, which forwards a request
 * to Jellyfin for an image Jellyfin holds. This serves bytes we fetched
 * ourselves, precisely for the channels Jellyfin has no image for -- see
 * lib/channelLogoCache.ts for why those exist.
 *
 * Signed-in viewers only, matching the image proxy: Live TV is for the
 * household, not the internet.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await params;
  const bytes = await readCachedLogo(key);
  if (!bytes) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      // From the bytes, not assumed: the cache accepts png, jpeg, webp and
      // gif under one extension, and mislabelling a JPEG renders nothing in
      // some browsers -- which looks identical to the missing logo this is
      // meant to fix.
      "Content-Type": sniffImageType(bytes),
      // Immutable for a given key: the key is a hash of the upstream URL, so
      // different bytes mean a different key.
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
