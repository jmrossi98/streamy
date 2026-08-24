import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelRadarrDownload, deleteRadarrMovie } from "@/lib/radarr";
import { cancelSonarrDownload, deleteSonarrSeries } from "@/lib/sonarr";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const id = typeof body?.id === "number" ? body.id : null;
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : null;
  const action = body?.action === "cancel" || body?.action === "delete" ? body.action : null;
  if (id === null || !mediaType || !action) {
    return NextResponse.json({ error: "id, mediaType, and action required" }, { status: 400 });
  }

  const ok =
    action === "cancel"
      ? mediaType === "movie"
        ? // unmonitor as well, so a cancel from the admin panel sticks rather
          // than being re-grabbed by the idle-title healer
          await cancelRadarrDownload(id, { unmonitor: true })
        : await cancelSonarrDownload(id)
      : mediaType === "movie"
        ? await deleteRadarrMovie(id)
        : await deleteSonarrSeries(id);

  if (!ok) {
    return NextResponse.json({ error: `Couldn't ${action}` }, { status: 404 });
  }

  // Clear Streamy's own row as well, keyed by the Radarr/Sonarr id this
  // route works in. Without this the title page keeps reporting the old
  // status until status reconciliation catches up, so cancelling from the
  // admin panel looked like it hadn't taken effect.
  await prisma.mediaRequest.deleteMany({ where: { mediaType, externalId: id } });

  return NextResponse.json({ ok: true });
}
