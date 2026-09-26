import { redirect } from "next/navigation";

/**
 * /admin has no content of its own any more.
 *
 * It used to be one page holding everything; the sections are tabs now, so this
 * sends people to the first of them rather than being a duplicate landing page
 * that would have to be kept in step with the tab list.
 */
export default function AdminIndexPage() {
  redirect("/admin/security");
}
