import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function RootLoading() {
  return (
    <div className="min-h-screen bg-netflix-black flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}
