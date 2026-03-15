import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ inList: false });
  }
  const { searchParams } = new URL(request.url);
  const movieId = searchParams.get("movieId");
  const showId = searchParams.get("showId");
  if (movieId) {
    const item = await prisma.watchlistItem.findUnique({
      where: {
        userId_movieId: { userId: session.user.id, movieId },
      },
    });
    return NextResponse.json({ inList: !!item });
  }
  if (showId) {
    const item = await prisma.watchlistShowItem.findUnique({
      where: {
        userId_showId: { userId: session.user.id, showId },
      },
    });
    return NextResponse.json({ inList: !!item });
  }
  return NextResponse.json({ inList: false });
}
