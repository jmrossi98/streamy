import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { isGamarrConfigured, queueGame, removeWishlistItem, retryGameDownload } from "@/lib/gamarr";

/**
 * Queues a game for download, and the two management actions that go with it
 * (drop a queued item, retry a failed job). All three are one route because
 * they share the same auth + configuration guard and are always driven from
 * the same panel.
 *
 * Queueing adds to gamarr's wishlist and kicks its scheduler -- see
 * queueGame() for why the kick is best-effort and the wishlist add is not.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!isGamarrConfigured()) {
    return NextResponse.json({ error: "gamarr is not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;

  if (action === "remove") {
    const id = typeof body.id === "number" ? body.id : null;
    if (id === null) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await removeWishlistItem(id);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Couldn't remove that item" }, { status: 502 });
  }

  if (action === "retry") {
    const jobId = typeof body.jobId === "string" ? body.jobId : null;
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
    const ok = await retryGameDownload(jobId);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Couldn't retry that download" }, { status: 502 });
  }

  // Default action: queue a search result.
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const platform = typeof body.platform === "string" ? body.platform : "";
  const platformSlug = typeof body.platformSlug === "string" ? body.platformSlug : "";
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const result = await queueGame({ title, platform, platformSlug });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
