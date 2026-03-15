import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function WhoIsWatchingLoading() {
  return (
    <div className="min-h-screen bg-netflix-black flex items-center justify-center">
      <LoadingSpinner label="Loading…" />
    </div>
  );
}
