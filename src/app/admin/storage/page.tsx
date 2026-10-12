import { redirect } from "next/navigation";

/**
 * The storage chart now sits at the top of the Downloads tab.
 *
 * Kept as a redirect rather than deleted: this path is bookmarkable, and a 404
 * would read as the feature having been removed rather than renamed.
 */
export default function AdminStoragePage() {
  redirect("/admin/downloads");
}
