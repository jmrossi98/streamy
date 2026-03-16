import Image from "next/image";
import Link from "next/link";

type InfoHeroProps = {
  backdropUrl: string;
  title: string;
  addToMyListNode: React.ReactNode;
  playHref: string;
  playLabel: string;
  /** When set, used instead of the Link so e.g. Play can open an overlay. */
  playNode?: React.ReactNode;
};

export function InfoHero({
  backdropUrl,
  title,
  addToMyListNode,
  playHref,
  playLabel,
  playNode,
}: InfoHeroProps) {
  return (
    <div className="relative min-h-[280px] sm:min-h-[360px] h-[70vh] sm:h-[75vh] w-full max-w-[1920px] mx-auto">
      <Image
        src={backdropUrl}
        alt=""
        fill
        className="object-cover"
        sizes="100vw"
        priority
      />
      <div className="hero-overlay absolute inset-0" />
      <div className="absolute inset-0 flex flex-col justify-end z-10 px-4 sm:px-6 pt-[50vh] sm:pt-[55vh] pb-6 sm:pb-8 text-center md:text-left">
        <h1 className="font-display text-4xl sm:text-5xl md:text-5xl lg:text-6xl font-bold text-white drop-shadow-lg max-w-3xl mx-auto md:mx-0">
          {title}
        </h1>
        <div className="mt-3 sm:mt-4 flex items-center justify-center md:justify-start gap-3 flex-wrap">
          {addToMyListNode}
          {playNode ?? (
            <Link
              href={playHref}
              prefetch
              className="inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[140px] sm:min-w-[160px] px-5 sm:px-6 py-3 bg-white text-netflix-black font-semibold rounded hover:bg-white/90 active:bg-white/80 transition-colors touch-manipulation"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {playLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
