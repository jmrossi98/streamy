import Link from "next/link";
import Image from "next/image";
import type { Movie } from "@/lib/tmdb";
import { PrefetchMovieOnHover } from "@/components/PrefetchMovieOnHover";

type HeroProps = { featured: Movie; progressSeconds?: number };

export function Hero({ featured, progressSeconds = 0 }: HeroProps) {
  const showResume = progressSeconds > 0;

  return (
    <section className="relative h-[88vh] min-h-[360px] sm:min-h-[460px] md:min-h-[560px] w-full">
      <div className="absolute inset-0">
        <Image
          src={featured.backdrop}
          alt=""
          fill
          className="object-cover"
          priority
          sizes="100vw"
          unoptimized
        />
        <div className="hero-overlay absolute inset-0" />
      </div>
      <PrefetchMovieOnHover movieId={featured.id} movie={featured}>
        <div className="relative z-10 h-full px-4 sm:px-6 pt-[50vh] sm:pt-[55vh] pb-12 sm:pb-16 md:pb-24 max-w-[1920px] mx-auto text-center md:text-left">
          <h1 className="font-display text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold text-white drop-shadow-lg max-w-3xl mx-auto md:mx-0">
            {featured.title}
          </h1>
          <p className="mt-3 sm:mt-4 text-base sm:text-lg md:text-xl text-white/90 max-w-xl line-clamp-3 drop-shadow mx-auto md:mx-0">
            {featured.overview}
          </p>
          <div className="mt-4 sm:mt-6 flex flex-wrap gap-3 justify-center md:justify-start">
            <Link
              href={`/watch/${featured.id}/play`}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 sm:px-8 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90 active:bg-white/80 transition-colors touch-manipulation"
            >
              {showResume ? (
                <>
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Watch now
                </>
              )}
            </Link>
            <Link
              href={`/watch/${featured.id}`}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 sm:px-8 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 active:bg-white/40 transition-colors touch-manipulation"
            >
              More Info
            </Link>
          </div>
          <div className="mt-3 sm:mt-4 flex items-center gap-4 text-sm text-white/80 justify-center md:justify-start">
            <span className="font-medium text-green-400">{featured.rating} Rating</span>
            {featured.year && <span>{featured.year}</span>}
            {featured.duration && <span>{featured.duration}</span>}
          </div>
        </div>
      </PrefetchMovieOnHover>
    </section>
  );
}
