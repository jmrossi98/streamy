import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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

  return NextResponse.json({ ok: true });
}
