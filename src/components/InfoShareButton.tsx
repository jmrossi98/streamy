"use client";

type Props = { title: string; className?: string };

export function InfoShareButton({ title, className = "" }: Props) {
  async function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user cancelled or share failed */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className={`flex flex-col items-center gap-1.5 text-white/90 transition-opacity hover:opacity-100 active:opacity-80 ${className}`}
      aria-label="Share"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 bg-white/10 backdrop-blur-sm">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      </span>
      <span className="max-w-[4.5rem] text-center text-[10px] font-semibold uppercase tracking-wider text-white/55">
        Share
      </span>
    </button>
  );
}
