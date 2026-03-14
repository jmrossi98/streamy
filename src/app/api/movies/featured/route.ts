import { NextResponse } from "next/server";
import { getFeaturedMovie } from "@/lib/movies";

export async function GET() {
  const movie = getFeaturedMovie();
  if (!movie) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(movie);
}
