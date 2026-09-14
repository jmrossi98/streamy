import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { flashpointLogoUrl, flashpointScreenshotUrl } from "@/lib/flashpoint";

/**
 * Box art and screenshots from Flashpoint, proxied.
 *
 * Proxied rather than hot-linked so a page render doesn't fan out into dozens
 * of direct requests to a volunteer-run archive from every viewer's browser --
 * and so the cache headers are ours to set. Entry artwork never changes for a
 * given id, so it caches hard.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind");
  const upstream = kind === "screenshot" ? flashpointScreenshotUrl(id) : flashpointLogoUrl(id);

  try {
    const res = await fetch(upstream, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.body) {
      // Plenty of entries simply have no art; that's a 404, not a fault.
      return NextResponse.json({ error: "No image" }, { status: 404 });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archive unreachable" }, { status: 502 });
  }
}
