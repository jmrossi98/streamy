import Image from "next/image";
import Link from "next/link";
import { InfoShareButton } from "@/components/InfoShareButton";
import { InfoDetailsLink } from "@/components/InfoDetailsLink";

type InfoHeroProps = {
  backdropUrl: string;
  title: string;
  /** My List control in the mobile icon row (compact circle). */
  addToMyListMobile: React.ReactNode;
  /** My List in the desktop hero button row (default wide button). */
  addToMyListDesktop: React.ReactNode;
  playHref: string;
  playLabel: string;
  playNode?: React.ReactNode;
  metaLine?: string | null;
  badgeNodes?: React.ReactNode;
};

export function InfoHero({
  backdropUrl,
  title,
  addToMyListMobile,
  addToMyListDesktop,
  playHref,
  playLabel,
  playNode,
  metaLine,
  badgeNodes,
}: InfoHeroProps) {
  const playClassDesktop =
    "inline-flex min-h-[44px] min-w-[140px] items-center justify-center gap-2 rounded bg-white px-6 py-3 font-semibold text-netflix-black hover:bg-white/90 active:bg-white/80 sm:min-w-[160px] touch-manipulation";

  return (
    <div className="w-full">
      {/* —— Mobile only: streaming-style short hero + black panel —— */}
      <div className="md:hidden">
        <div
          className="
            relative mx-auto h-[42svh] max-h-[520px] min-h-[240px] w-full max-w-[1920px]
            sm:h-[48svh] sm:max-h-[600px] sm:min-h-[300px]
          "
        >
          <Image
            src={backdropUrl}
            alt=""
            fill
            className="object-cover object-[center_20%]"
            sizes="100vw"
            priority
          />
          <div className="hero-overlay absolute inset-0" aria-hidden />
          <div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-black/40 to-black"
            aria-hidden
          />
          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center justify-end px-4 pb-6 pt-16 text-center">
            <h1 className="font-display max-w-4xl text-3xl font-bold leading-[1.08] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.85)] sm:text-4xl">
              {title}
            </h1>
          </div>
        </div>

        <div className="border-t border-white/5 bg-black px-4 pb-10 pt-6 sm:px-6">
          <div className="mx-auto max-w-4xl">
            {badgeNodes != null && (
              <div className="mb-4 flex flex-wrap items-center justify-center gap-2">{badgeNodes}</div>
            )}
            {metaLine != null && metaLine.length > 0 && (
              <p className="mb-6 text-center text-sm leading-relaxed text-white/65">{metaLine}</p>
            )}
            <div className="mx-auto w-full max-w-xl">
              {playNode != null ? (
                <div className="w-full">{playNode}</div>
              ) : (
                <Link
                  href={playHref}
                  prefetch
                  className="inline-flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-6 py-4 text-sm font-bold uppercase tracking-[0.14em] text-netflix-black shadow-lg shadow-black/30 hover:bg-white/90 active:bg-white/85 touch-manipulation"
                >
                  <svg className="h-6 w-6 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {playLabel}
                </Link>
              )}
            </div>
            <div className="mt-8 flex touch-pan-y items-start justify-center gap-6 px-2 sm:gap-10">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex justify-center">{addToMyListMobile}</div>
                <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-white/45">
                  My List
                </span>
              </div>
              <InfoShareButton title={title} />
              <InfoDetailsLink />
            </div>
          </div>
        </div>
      </div>

      {/* —— Desktop only: original single hero + title + watchlist + play —— */}
      <div
        className="
          relative mx-auto hidden min-h-[360px] h-[min(72vh,800px)] w-full max-w-[1920px]
          md:block
        "
      >
        <Image
          src={backdropUrl}
          alt=""
          fill
          className="object-cover"
          sizes="100vw"
          priority
        />
        <div className="hero-overlay absolute inset-0" />
        <div
          className="
            absolute inset-0 z-10 flex touch-pan-y flex-col justify-end px-6 pb-8 pt-6 text-left
            sm:px-6 sm:pb-8 sm:pt-8 md:px-10 md:pb-10
          "
        >
          <h1 className="font-display max-w-3xl text-5xl font-bold leading-tight text-white drop-shadow-lg lg:text-6xl">
            {title}
          </h1>
          <div
            className="
              mt-4 grid w-full max-w-lg grid-cols-2 gap-3 sm:mt-5 sm:flex sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center
              [&_a]:w-full [&_button]:w-full sm:[&_a]:w-auto sm:[&_button]:w-auto
            "
          >
            {addToMyListDesktop}
            {playNode != null ? (
              playNode
            ) : (
              <Link href={playHref} prefetch className={playClassDesktop}>
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                {playLabel}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
