import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { flashFileUpstreamUrl, isFlashLibraryConfigured } from "@/lib/flashLibrary";

/**
 * Serves one SWF to Ruffle.
 *
 * Proxied rather than linked for the same reasons Jellyfin playback is: the
 * library lives on a Tailscale-only plain-HTTP address that a viewer's browser
 * can't route to, and an HTTPS page couldn't load from it even if it could.
 *
 * Signed-in viewers, not admins. Flash games are the half of the Games tab
 * meant for the whole household -- the ROM/emulator half is what stays
 * admin-only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> }
) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isFlashLibraryConfigured()) {
    return NextResponse.json({ error: "Flash library not configured" }, { status: 503 });
  }

  const { fileName } = await params;
  // Null means the name failed the safe-filename check, which is a traversal
  // attempt or a corrupt row -- either way not something to pass upstream.
  const upstream = flashFileUpstreamUrl(decodeURIComponent(fileName));
  if (!upstream) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Streamed, not buffered: these run to several megabytes and there is no
    // reason for the whole file to sit in this process's memory.
    return new Response(res.body, {
      headers: {
        "Content-Type": "application/x-shockwave-flash",
        ...(res.headers.get("content-length")
          ? { "Content-Length": res.headers.get("content-length")! }
          : {}),
        // An import lands under a new name rather than overwriting, so a given
        // URL's bytes never change.
        "Cache-Control": "public, max-age=604800, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Library unreachable" }, { status: 502 });
  }
}
