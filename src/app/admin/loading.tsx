import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function AdminLoading() {
  return (
    // Inside the admin layout, which already pads the top: no second pt-24.
    <div className="flex items-center justify-center py-16">
      <LoadingSpinner label="Loading admin…" />
    </div>
  );
}
