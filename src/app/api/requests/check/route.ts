import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ status: null });
  }

  const { searchParams } = new URL(request.url);
  const tmdbId = searchParams.get("tmdbId");
  const mediaType = searchParams.get("mediaType");
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "show")) {
    return NextResponse.json({ status: null });
  }

  const row = await prisma.mediaRequest.findUnique({
    where: { userId_tmdbId_mediaType: { userId: session.user.id, tmdbId, mediaType } },
  });
  return NextResponse.json({ status: row?.status ?? null });
}
