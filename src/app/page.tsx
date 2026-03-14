import { Hero } from "@/components/Hero";
import { MovieRow } from "@/components/MovieRow";
import { getTrending, getGenres, getDiscoverByGenre } from "@/lib/tmdb";

const HERO_GENRE_IDS = [28, 35, 18, 27, 878]; // Action, Comedy, Drama, Horror, Sci-Fi

export default async function HomePage() {
  const [trending, genres] = await Promise.all([
    getTrending(12),
    getGenres(),
  ]);

  const featured = trending[0];
  if (!featured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <p className="text-white/80 text-center max-w-md">
          No trending movies loaded. Check that TMDB_API_KEY is set in your environment.
        </p>
      </div>
    );
  }

  const heroGenres = genres.filter((g) => HERO_GENRE_IDS.includes(g.id));
  const genreRows = await Promise.all(
    heroGenres.map(async (genre) => ({
      title: genre.name,
      movies: await getDiscoverByGenre(genre.id, 10),
    }))
  );

  return (
    <>
      <Hero featured={featured} />
      <div id="movies" className="space-y-2">
        <MovieRow title="Trending Now" movies={trending} />
        {genreRows.map(
          (row) =>
            row.movies.length > 0 && (
              <MovieRow key={row.title} title={row.title} movies={row.movies} />
            )
        )}
      </div>
    </>
  );
}
