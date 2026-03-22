import Link from "next/link";
import Image from "next/image";
import type { Movie } from "@/lib/tmdb";
import { PrefetchMovieOnHover } from "@/components/PrefetchMovieOnHover";

type HeroProps = { featured: Movie; progressSeconds?: number };

export function Hero({ featured, progressSeconds = 0 }: HeroProps) {
  const showResume = progressSeconds > 0;

  return (
    {/* Mobile: horizontal inset + rounded “card” hero; desktop: full-bleed */}
    <section className="w-full px-4 md:px-0">
      <div
        className="
          relative mx-auto w-full max-w-[1920px] max-md:overflow-hidden md:overflow-visible
          max-md:min-h-[360px] max-md:h-[min(72svh,720px)] max-md:rounded-3xl
          max-md:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.55)] max-md:ring-1 max-md:ring-white/10
          md:relative md:h-[88vh] md:min-h-[560px] md:rounded-none md:shadow-none md:ring-0
        "
      >
        <div className="absolute inset-0 overflow-hidden max-md:rounded-3xl md:rounded-none">
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
          {/* Extra bottom fade — mobile card only; web uses hero-overlay alone like before */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent md:hidden"
            aria-hidden
          />
        </div>
        <PrefetchMovieOnHover movieId={featured.id} movie={featured}>
          {/*
            Mobile: centered, card inset. Desktop: flex justify-end + items-start = true bottom-left
            (avoids pt-[50vh] + overflow-hidden clipping buttons when title/overview is tall).
          */}
          <div
            className="
              relative z-10 mx-auto flex h-full max-w-[1920px] flex-col justify-end
              max-md:touch-pan-y max-md:items-center max-md:px-5
              max-md:pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] max-md:pt-8 max-md:text-center
              md:items-start md:px-6 md:pb-28 md:pt-24 md:text-left
            "
          >
            <p className="mb-2 inline-flex items-center justify-center gap-2 self-center rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/95 backdrop-blur-sm md:hidden">
              Trending
            </p>
            <h1 className="font-display mx-auto max-w-3xl text-3xl font-bold uppercase leading-[1.05] tracking-wide text-white drop-shadow-lg sm:text-4xl md:mx-0 md:max-w-[min(100%,52rem)] md:text-5xl md:drop-shadow-lg lg:text-7xl xl:text-8xl">
              {featured.title}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-snug text-white/90 drop-shadow sm:text-base md:mx-0 md:mt-4 md:max-w-2xl md:text-lg md:text-xl max-md:line-clamp-3 lg:max-w-3xl">
              {featured.overview}
            </p>
            <div
              className="
                mt-5 grid w-full max-w-lg grid-cols-2 gap-3 max-md:mx-auto
                md:mt-6 md:flex md:max-w-none md:flex-wrap md:gap-3 md:justify-start
                max-md:[&_a]:w-full md:[&_a]:w-auto
              "
            >
              <Link
                href={`/watch/${featured.id}/play`}
                className="inline-flex min-h-[48px] w-full min-w-0 items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-netflix-black shadow-lg shadow-black/30 hover:bg-white/90 active:bg-white/80 max-md:min-h-[48px] md:min-h-[44px] md:w-auto md:rounded md:px-8 md:py-3 md:shadow-none touch-manipulation"
              >
                {showResume ? (
                  <>
                    <svg className="h-6 w-6 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Resume
                  </>
                ) : (
                  <>
                    <svg className="h-6 w-6 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Watch now
                  </>
                )}
              </Link>
              <Link
                href={`/watch/${featured.id}`}
                className="inline-flex min-h-[48px] w-full min-w-0 items-center justify-center gap-2 rounded-full border border-white/50 bg-white/10 px-4 py-3 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/20 active:bg-white/25 max-md:min-h-[48px] md:min-h-[44px] md:w-auto md:rounded md:border-white/40 md:px-8 md:py-3 touch-manipulation"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/70 text-[11px] font-bold leading-none">
                  i
                </span>
                More Info
              </Link>
            </div>
            <div className="mb-2 mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm max-md:text-white/75 md:mb-4 md:mt-6 md:justify-start md:gap-4 md:text-white/80">
              <span className="font-medium text-green-400">{featured.rating} Rating</span>
              {featured.year != null && (
                <>
                  <span className="text-white/40 md:hidden" aria-hidden>
                    ·
                  </span>
                  <span>{featured.year}</span>
                </>
              )}
              {featured.duration != null && (
                <>
                  <span className="text-white/40 md:hidden" aria-hidden>
                    ·
                  </span>
                  <span>{featured.duration}</span>
                </>
              )}
            </div>
          </div>
        </PrefetchMovieOnHover>
      </div>
    </section>
  );
}
