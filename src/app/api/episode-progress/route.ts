import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ progress: null });
  const { searchParams } = new URL(request.url);
  const showId = searchParams.get("showId");
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");
  if (!showId || season == null || episode == null) return NextResponse.json({ progress: null });
  const sn = parseInt(season, 10);
  const en = parseInt(episode, 10);
  if (Number.isNaN(sn) || Number.isNaN(en)) return NextResponse.json({ progress: null });
  const row = await prisma.episodeProgress.findUnique({
    where: {
      userId_showId_seasonNumber_episodeNumber: {
        userId: session.user.id,
        showId,
        seasonNumber: sn,
        episodeNumber: en,
      },
    },
  });
  return NextResponse.json({
    progress: row ? { progressSeconds: row.progressSeconds } : null,
  });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const { showId, seasonNumber, episodeNumber, progressSeconds } = body;
  if (
    typeof showId !== "string" ||
    !showId.trim() ||
    typeof seasonNumber !== "number" ||
    typeof episodeNumber !== "number"
  ) {
    return NextResponse.json({ error: "showId, seasonNumber, episodeNumber required" }, { status: 400 });
  }
  const sec = typeof progressSeconds === "number" && progressSeconds >= 0 ? Math.floor(progressSeconds) : 0;
  await prisma.episodeProgress.upsert({
    where: {
      userId_showId_seasonNumber_episodeNumber: {
        userId: session.user.id,
        showId: showId.trim(),
        seasonNumber,
        episodeNumber,
      },
    },
    create: {
      userId: session.user.id,
      showId: showId.trim(),
      seasonNumber,
      episodeNumber,
      progressSeconds: sec,
    },
    update: { progressSeconds: sec },
  });
  revalidatePath("/");
  return NextResponse.json({ saved: true });
}
