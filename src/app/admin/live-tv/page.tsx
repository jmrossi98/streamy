import { redirect } from "next/navigation";

/**
 * The Live TV management tab was folded into the Streaming tab on 2026-10-18,
 * at its bottom. This route stays only to redirect old links and bookmarks
 * there rather than 404.
 */
export default function AdminLiveTvPage() {
  redirect("/admin/streaming");
}
