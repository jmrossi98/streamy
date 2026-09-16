import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { flashpointLogoUrl, flashpointScreenshotUrl } from "@/lib/flashpoint";

/**
 * Card art for a Flash game, from whichever source actually has some.
 *
 * Proxied rather than hot-linked so a page render doesn't fan out into dozens
 * of direct requests to someone else's server from every viewer's browser --
 * and so the cache headers are ours to set. Artwork never changes for a given
 * game, so it caches hard.
 *
 * Tried in order, because no single source covers the catalogue:
 *
 *   1. Flashpoint's logo -- box art, the best thing to show
 *   2. Flashpoint's screenshot -- less tidy, but it is the actual game
 *   3. Andkon's icon, when the game has an Andkon path. Roughly half the
 *      catalogue has no Flashpoint entry at all, so for those this is the
 *      only artwork in existence.
 *
 * The subtlety that made this worth doing: Flashpoint's image endpoints never
 * 404. Asked for an id they don't have, they answer 200 with a fixed 4,747-byte
 * "no image" placeholder -- verified identical across several bogus ids. So
 * `res.ok` was always true, every card got the placeholder, and neither the
 * screenshot nor Andkon was ever reached. Hashing the body is what tells a
 * real image from that one.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * sha256 of Flashpoint's "no image" placeholder.
 *
 * Fetched live from /logo and /screenshot for three ids that cannot exist; all
 * six responses were byte-identical.
 */
const PLACEHOLDER_SHA256 =
  "d13bdf73830bf70468a562c4d5be78ce05d598b811d0c8dc19550ffbd38b8a6b";
/** Cheap pre-check, so the hash is only computed for a body that could be it. */
const PLACEHOLDER_BYTES = 4747;

/** Andkon's icons live in one flat directory, keyed by the game's own slug. */
const SAFE_SLUG = /^[a-z0-9._-]{1,80}$/;

type Art = { bytes: Buffer; type: string } | null;

async function fetchArt(url: string, allowPlaceholder = false): Promise<Art> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return null;
    if (
      !allowPlaceholder &&
      bytes.length === PLACEHOLDER_BYTES &&
      createHash("sha256").update(bytes).digest("hex") === PLACEHOLDER_SHA256
    ) {
      return null;
    }
    return { bytes, type: res.headers.get("Content-Type") ?? "image/png" };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const andkonSlug = new URL(request.url).searchParams.get("andkon");

  // "none" is how a card with no Flashpoint entry asks for Andkon's icon
  // without needing a second route.
  const hasFlashpoint = id !== "none" && id.length > 0;

  let art: Art = null;
  if (hasFlashpoint) {
    art = await fetchArt(flashpointLogoUrl(id));
    if (!art) art = await fetchArt(flashpointScreenshotUrl(id));
  }
  if (!art && andkonSlug && SAFE_SLUG.test(andkonSlug)) {
    // Andkon 404s honestly for an unknown slug, so no placeholder check.
    art = await fetchArt(`https://www.andkon.com/arcade/ICONS/${andkonSlug}.gif`, true);
  }

  if (!art) {
    // Plenty of games genuinely have no art anywhere. A 404 is what lets the
    // card fall back to its title treatment, which is more useful than a
    // generic placeholder -- the title is the only thing telling one of these
    // apart from another.
    return NextResponse.json({ error: "No image" }, { status: 404 });
  }

  return new Response(new Uint8Array(art.bytes), {
    headers: {
      "Content-Type": art.type,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
