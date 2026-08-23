import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cancelRadarrDownload } from "@/lib/radarr";
import { cancelSonarrDownload } from "@/lib/sonarr";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const id = typeof body?.id === "number" ? body.id : null;
  const mediaType = body?.mediaType === "movie" || body?.mediaType === "show" ? body.mediaType : null;
  if (id === null || !mediaType) {
    return NextResponse.json({ error: "id and mediaType required" }, { status: 400 });
  }

  const cancelled = mediaType === "movie" ? await cancelRadarrDownload(id) : await cancelSonarrDownload(id);
  if (!cancelled) {
    return NextResponse.json({ error: "Download not found in the active queue" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
