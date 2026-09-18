import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function GamesLoading() {
  return (
    <div className="min-h-screen bg-netflix-black pt-24 flex items-center justify-center">
      <LoadingSpinner label="Loading games…" />
    </div>
  );
}
