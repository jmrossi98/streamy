export function LoadingSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="w-12 h-12 rounded-full border-2 border-white/30 border-t-white animate-spin"
        aria-hidden
      />
      <p className="text-white/70 text-sm">{label}</p>
    </div>
  );
}
