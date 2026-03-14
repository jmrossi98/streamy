import { getTrendingTV, getTVGenres, getDiscoverTVByGenre } from "@/lib/tmdb";
import { TVRow } from "@/components/TVRow";

export const dynamic = "force-dynamic";

const TV_ROW_GENRE_LIMIT = 6;

export default async function TVPage() {
  const [trending, genres] = await Promise.all([
    getTrendingTV(12),
    getTVGenres(),
  ]);

  const genresForRows = genres.slice(0, TV_ROW_GENRE_LIMIT);
  const genreRows = await Promise.all(
    genresForRows.map(async (genre) => ({
      title: genre.name,
      shows: await getDiscoverTVByGenre(genre.id, 10),
    }))
  );

  return (
    <main className="min-h-screen pt-24 pb-12">
      <div className="space-y-2">
        <TVRow title="Trending TV" shows={trending} />
        {genreRows.map((row) => (
          <TVRow key={row.title} title={row.title} shows={row.shows} />
        ))}
      </div>
    </main>
  );
}
