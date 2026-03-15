import { getTrendingTV, getTVGenres, getDiscoverTVByGenre } from "@/lib/tmdb";
import { TVRow } from "@/components/TVRow";

export const dynamic = "force-dynamic";

const TV_ROW_GENRE_LIMIT = 4;
const SHOWS_PER_ROW = 8;

export default async function TVPage() {
  const [trending, genres] = await Promise.all([
    getTrendingTV(10),
    getTVGenres(),
  ]);

  const genresForRows = genres.slice(0, TV_ROW_GENRE_LIMIT);
  const genreRows = await Promise.all(
    genresForRows.map((genre) =>
      getDiscoverTVByGenre(genre.id, SHOWS_PER_ROW).then((shows) => ({
        title: genre.name,
        shows,
      }))
    )
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
