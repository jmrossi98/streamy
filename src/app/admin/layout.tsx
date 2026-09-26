import { redirect } from "next/navigation";
import { getSession, requireAdmin } from "@/lib/auth";
import { AdminTabs } from "@/components/AdminTabs";

/**
 * The admin shell: one authorization check, one set of tabs.
 *
 * The gate lives here rather than on each page because a layout wraps every
 * route beneath it, so a new admin page cannot be added without it. When each
 * page checked for itself, forgetting the check on one of them would have been
 * a silent authorization hole rather than a visible mistake.
 *
 * Authorization reads the database, not the session's isAdmin claim: a demoted
 * or deleted admin must lose these pages immediately rather than whenever their
 * 30-day token happens to expire.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await requireAdmin(await getSession()))) {
    redirect("/");
  }

  return (
    // Mobile keeps max-w-2xl and a single column, which reads well at that
    // width; everything wider is lg:-prefixed.
    <div className="min-h-screen px-4 sm:px-6 pt-24 pb-16 max-w-2xl lg:max-w-6xl 2xl:max-w-[88rem] mx-auto">
      <h1 className="font-display text-3xl font-bold text-white">Admin</h1>
      <AdminTabs />
      <div className="mt-8">{children}</div>
    </div>
  );
}
