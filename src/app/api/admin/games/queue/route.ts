import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import {
  cancelGameDownload,
  isGamarrConfigured,
  queueGame,
  removeWishlistItem,
  retryGameDownload,
} from "@/lib/gamarr";
import { logAudit } from "@/lib/auditLog";

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
  const admin = await requireAdmin(await getSession());
  if (!admin) {
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
  // Audit-log display only, when the caller has it in scope -- never used
  // to identify what to act on.
  const logTitle = typeof body.title === "string" && body.title ? body.title : null;

  if (action === "remove") {
    const id = typeof body.id === "number" ? body.id : null;
    if (id === null) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await removeWishlistItem(id);
    if (!ok) return NextResponse.json({ error: "Couldn't remove that item" }, { status: 502 });
    logAudit(admin.name, "game.queue.remove", logTitle ?? `wishlist #${id}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "retry") {
    const jobId = typeof body.jobId === "string" ? body.jobId : null;
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
    const ok = await retryGameDownload(jobId);
    if (!ok) return NextResponse.json({ error: "Couldn't retry that download" }, { status: 502 });
    logAudit(admin.name, "game.download.retry", logTitle ?? `job ${jobId}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    const jobId = typeof body.jobId === "string" ? body.jobId : null;
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
    const ok = await cancelGameDownload(jobId);
    if (!ok) return NextResponse.json({ error: "Couldn't cancel that download" }, { status: 502 });
    logAudit(admin.name, "game.download.cancel", logTitle ?? `job ${jobId}`);
    return NextResponse.json({ ok: true });
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
  logAudit(admin.name, "game.queue", title, platform);
  return NextResponse.json({ ok: true });
}
