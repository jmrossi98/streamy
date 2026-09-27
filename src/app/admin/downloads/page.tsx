import { redirect } from "next/navigation";

/**
 * Downloads now live on the storage tab, under the storage chart.
 *
 * Kept as a redirect rather than deleted: this path is bookmarkable, it is
 * what older links point at, and a 404 would read as the feature having been
 * removed rather than moved.
 */
export default function AdminDownloadsPage() {
  redirect("/admin/storage");
}
