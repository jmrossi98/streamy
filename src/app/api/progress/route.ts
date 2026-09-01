import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findJellyfinMovieItemId, setJellyfinPlaybackPositionSeconds } from "@/lib/jellyfin";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ progress: null });
  }
  const { searchParams } = new URL(request.url);
  const movieId = searchParams.get("movieId");
  if (!movieId) {
    return NextResponse.json({ progress: null });
  }
  const row = await prisma.watchProgress.findUnique({
    where: {
      userId_movieId: { userId: session.user.id, movieId },
    },
  });
  return NextResponse.json({
    progress: row ? { progressSeconds: row.progressSeconds } : null,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const movieId = body?.movieId;
  const progressSeconds = body?.progressSeconds;
  if (typeof movieId !== "string" || !movieId.trim()) {
    return NextResponse.json({ error: "movieId required" }, { status: 400 });
  }
  const seconds = typeof progressSeconds === "number" && progressSeconds >= 0
    ? Math.floor(progressSeconds)
    : 0;
  await prisma.watchProgress.upsert({
    where: {
      userId_movieId: { userId, movieId: movieId.trim() },
    },
    create: { userId, movieId: movieId.trim(), progressSeconds: seconds },
    update: { progressSeconds: seconds },
  });
  revalidatePath("/");
  // Fire-and-forget: pushes this position to the shared Jellyfin account too
  // (see setJellyfinPlaybackPositionSeconds), so the household's Roku app
  // picks up where this web session left off. Not awaited -- an extra
  // Jellyfin round trip on every periodic progress save would add real
  // latency to a request the player doesn't otherwise wait on, and this is
  // best-effort by design (see the callee's own doc).
  findJellyfinMovieItemId(movieId.trim())
    .then((itemId) => {
      if (itemId) void setJellyfinPlaybackPositionSeconds(itemId, seconds);
    })
    .catch(() => {});
  return NextResponse.json({ saved: true });
}
