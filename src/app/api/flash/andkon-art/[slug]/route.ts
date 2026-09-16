import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Card art for a game that only Andkon has.
 *
 * Flashpoint entries get their box art from /api/flash/art/[id]; about half
 * the catalogue has no Flashpoint entry at all, and Andkon's own icons are
 * the only artwork those games have.
 *
 * Proxied rather than hot-linked, for the same reasons as the Flashpoint art
 * route: a page render shouldn't fan out into dozens of direct requests to
 * someone else's server from every viewer's browser, and the cache headers
 * should be ours to set. These icons never change for a given slug.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Andkon's icons live in one flat directory, keyed by the game's own slug. */
const SAFE_SLUG = /^[a-z0-9._-]{1,80}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  // Checked rather than escaped: this becomes a path on someone else's server,
  // and a slug with a slash or a ".." in it has no legitimate form.
  if (!SAFE_SLUG.test(slug)) {
    return NextResponse.json({ error: "Bad slug" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://www.andkon.com/arcade/ICONS/${slug}.gif`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok || !res.body) {
      // Plenty of games have no icon; that's a 404, not a fault. The card
      // falls back to showing the title.
      return NextResponse.json({ error: "No image" }, { status: 404 });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/gif",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Upstream unavailable" }, { status: 502 });
  }
}
