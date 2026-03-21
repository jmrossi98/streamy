import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [movies, shows] = await Promise.all([
    prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
    prisma.watchlistShowItem.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
    }),
  ]);
  return NextResponse.json({
    movieIds: movies.map((i) => i.movieId),
    showIds: shows.map((i) => i.showId),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const movieId = body?.movieId != null ? String(body.movieId).trim() : "";
  const showId = body?.showId != null ? String(body.showId).trim() : "";
  if (movieId) {
    await prisma.watchlistItem.upsert({
      where: {
        userId_movieId: { userId, movieId },
      },
      create: { userId, movieId },
      update: {},
    });
    return NextResponse.json({ added: true, type: "movie" });
  }
  if (showId) {
    await prisma.watchlistShowItem.upsert({
      where: {
        userId_showId: { userId, showId },
      },
      create: { userId, showId },
      update: {},
    });
    return NextResponse.json({ added: true, type: "show" });
  }
  return NextResponse.json({ error: "movieId or showId required" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  const userId = await getValidSessionUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const movieId = searchParams.get("movieId");
  const showId = searchParams.get("showId");
  if (movieId) {
    await prisma.watchlistItem.deleteMany({
      where: { userId, movieId },
    });
    return NextResponse.json({ removed: true });
  }
  if (showId) {
    await prisma.watchlistShowItem.deleteMany({
      where: { userId, showId },
    });
    return NextResponse.json({ removed: true });
  }
  return NextResponse.json({ error: "movieId or showId required" }, { status: 400 });
}
