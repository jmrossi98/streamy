import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { WatchProviderItem } from "@/lib/tmdb";
import { getMovieById } from "@/lib/tmdb";

type Props = { params: Promise<{ id: string }> };

function JustWatchLink({ title }: { title: string }) {
  const q = encodeURIComponent(title);
  return (
    <a
      href={`https://www.justwatch.com/us/search?q=${q}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 bg-netflix-red text-white font-semibold rounded hover:bg-netflix-red/90 transition-colors"
    >
      Find where to watch
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function ProviderLogos({
  label,
  providers,
}: {
  label: string;
  providers: WatchProviderItem[];
}) {
  if (providers.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-white/60 text-sm mb-1">{label}</p>
      <div className="flex flex-wrap gap-2 items-center">
        {providers.map((p) => (
          <span
            key={p.name}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-white/10 text-white/90 text-sm"
            title={p.name}
          >
            <Image
              src={p.logoPath}
              alt=""
              width={24}
              height={24}
              className="object-contain rounded"
            />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function WatchPage({ params }: Props) {
  const { id } = await params;
  const movie = await getMovieById(id);
  if (!movie) notFound();

  const hasProviders =
    (movie.flatrate?.length ?? 0) > 0 ||
    (movie.rent?.length ?? 0) > 0 ||
    (movie.buy?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-netflix-black">
      <div className="relative h-[60vh] min-h-[400px]">
        <Image
          src={movie.backdrop}
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
        />
        <div className="hero-overlay absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Link
            href="/"
            className="w-20 h-20 rounded-full bg-white/90 flex items-center justify-center text-netflix-black hover:bg-white transition-colors shadow-xl"
          >
            <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </Link>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="font-display text-4xl md:text-5xl font-bold text-white">
          {movie.title}
        </h1>
        <p className="mt-4 text-white/80 text-lg">{movie.overview}</p>
        <div className="mt-6 flex flex-wrap gap-4 text-white/70">
          {movie.year && <span>{movie.year}</span>}
          {movie.duration && <span>{movie.duration}</span>}
          <span className="text-green-400 font-medium">{movie.rating} Rating</span>
        </div>
        {movie.genres.length > 0 && (
          <div className="mt-4 flex gap-2">
            {movie.genres.map((g) => (
              <span
                key={g}
                className="px-3 py-1 rounded bg-white/10 text-sm text-white/90"
              >
                {g}
              </span>
            ))}
          </div>
        )}

        <section className="mt-10 pt-8 border-t border-white/10">
          <h2 className="font-display text-2xl font-bold text-white mb-3">
            Where to watch
          </h2>
          <p className="text-white/70 text-sm mb-4">
            Streaming availability is provided by JustWatch. Open the link below to see
            where you can stream, rent, or buy this title.
          </p>
          <JustWatchLink title={movie.title} />
          {hasProviders && (
            <div className="mt-6 space-y-4">
              {movie.flatrate && (
                <ProviderLogos label="Stream (subscription)" providers={movie.flatrate} />
              )}
              {movie.rent && (
                <ProviderLogos label="Rent" providers={movie.rent} />
              )}
              {movie.buy && (
                <ProviderLogos label="Buy" providers={movie.buy} />
              )}
            </div>
          )}
        </section>

        <Link
          href="/"
          className="inline-block mt-8 text-netflix-red hover:underline font-medium"
        >
          ← Back to Browse
        </Link>
      </div>
    </div>
  );
}
