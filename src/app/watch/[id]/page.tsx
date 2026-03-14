import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { WatchProviderItem } from "@/lib/tmdb";
import { getMovieById } from "@/lib/tmdb";
import { WatchlistButton } from "@/components/WatchlistButton";

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
  const session = await getServerSession(authOptions);
  const [movie, progressRow] = await Promise.all([
    getMovieById(id),
    session?.user?.id
      ? prisma.watchProgress.findUnique({
          where: { userId_movieId: { userId: session.user.id, movieId: id } },
        })
      : null,
  ]);
  if (!movie) notFound();

  const hasProviders =
    (movie.flatrate?.length ?? 0) > 0 ||
    (movie.rent?.length ?? 0) > 0 ||
    (movie.buy?.length ?? 0) > 0;

  const progressSeconds = progressRow?.progressSeconds ?? 0;
  const hasProgress = progressSeconds > 0;

  return (
    <div className="min-h-screen bg-netflix-black">
      <div className="relative min-h-[400px] h-[60vh] w-full">
        <Image
          src={movie.backdrop}
          alt=""
          fill
          className="object-cover"
          sizes="100vw"
          priority
        />
        <div className="hero-overlay absolute inset-0" />
        <div className="relative z-10 h-full min-h-[400px] flex flex-col justify-end px-6 pb-8 max-w-[1920px] mx-auto">
          <h1 className="font-display text-4xl md:text-6xl font-bold text-white drop-shadow-lg max-w-3xl">
            {movie.title}
          </h1>
          <p className="mt-4 text-lg text-white/90 max-w-xl line-clamp-3 drop-shadow">
            {movie.overview}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/watch/${id}/play`}
              className="inline-flex items-center gap-2 px-8 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90 transition-colors"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {hasProgress ? "Resume" : "Play"}
            </Link>
            <WatchlistButton movieId={movie.id} />
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm text-white/80">
            <span className="font-medium text-green-400">{movie.rating} Rating</span>
            {movie.year && <span>{movie.year}</span>}
            {movie.duration && <span>{movie.duration}</span>}
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-white/80 text-lg">{movie.overview}</p>
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

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/watch/${id}/play`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            {hasProgress ? `Resume from ${Math.floor(progressSeconds / 60)}m` : "Play"}
          </Link>
          <WatchlistButton movieId={movie.id} />
        </div>

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
      </div>
    </div>
  );
}
