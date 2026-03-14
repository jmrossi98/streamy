import { NextResponse } from "next/server";
import { movies, getMoviesByGenre, getMovieById } from "@/lib/movies";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genre = searchParams.get("genre");
  const id = searchParams.get("id");

  if (id) {
    const movie = getMovieById(id);
    if (!movie) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(movie);
  }

  const list = genre ? getMoviesByGenre(genre) : movies;
  return NextResponse.json(list);
}
