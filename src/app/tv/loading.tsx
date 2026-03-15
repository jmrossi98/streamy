import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function TVLoading() {
  return (
    <div className="min-h-screen bg-netflix-black pt-24 flex items-center justify-center">
      <LoadingSpinner label="Loading TV shows…" />
    </div>
  );
}
