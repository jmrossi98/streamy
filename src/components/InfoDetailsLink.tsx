import Link from "next/link";

export function InfoDetailsLink() {
  return (
    <Link
      href="#details"
      className="flex flex-col items-center gap-1.5 text-white/90 transition-opacity hover:opacity-100 active:opacity-80"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/35 bg-white/10 backdrop-blur-sm">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </span>
      <span className="max-w-[4.5rem] text-center text-[10px] font-semibold uppercase tracking-wider text-white/55">
        Details
      </span>
    </Link>
  );
}
