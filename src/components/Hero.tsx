import Link from "next/link";
import Image from "next/image";
import type { Movie } from "@/lib/tmdb";

type HeroProps = { featured: Movie };

export function Hero({ featured }: HeroProps) {
  return (
    <section className="relative h-[85vh] min-h-[500px] w-full">
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
      <div className="relative z-10 h-full flex flex-col justify-end px-6 pb-[15%] max-w-[1920px] mx-auto">
        <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold text-white drop-shadow-lg max-w-3xl">
          {featured.title}
        </h1>
        <p className="mt-4 text-lg md:text-xl text-white/90 max-w-xl line-clamp-3 drop-shadow">
          {featured.overview}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/watch/${featured.id}`}
            className="inline-flex items-center gap-2 px-8 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90 transition-colors"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </Link>
          <Link
            href={`/watch/${featured.id}`}
            className="inline-flex items-center gap-2 px-8 py-3 bg-white/20 text-white font-semibold rounded border border-white/40 hover:bg-white/30 transition-colors"
          >
            More Info
          </Link>
        </div>
        <div className="mt-4 flex items-center gap-4 text-sm text-white/80">
          <span className="font-medium text-green-400">{featured.rating} Rating</span>
          {featured.year && <span>{featured.year}</span>}
          {featured.duration && <span>{featured.duration}</span>}
        </div>
      </div>
    </section>
  );
}
