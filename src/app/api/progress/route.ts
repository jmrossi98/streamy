import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  if (!session?.user?.id) {
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
      userId_movieId: { userId: session.user.id, movieId: movieId.trim() },
    },
    create: { userId: session.user.id, movieId: movieId.trim(), progressSeconds: seconds },
    update: { progressSeconds: seconds },
  });
  revalidatePath("/");
  return NextResponse.json({ saved: true });
}
