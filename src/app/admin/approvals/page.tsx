import { getSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminApprovals } from "@/components/AdminApprovals";
import { AdminAccounts } from "@/components/AdminAccounts";

export default async function AdminApprovalsPage() {
  // The layout has already refused non-admins; this is only for the id, so the
  // panel can mark the row the viewer is not allowed to delete.
  const admin = await requireAdmin(await getSession());
  // Cannot be null -- the layout already redirected a non-admin -- but the
  // type does not know that, and a cast would be a lie if the layout ever
  // changed. An empty id simply marks no row as self.
  const selfId = admin?.id ?? "";

  const [pendingUsers, accounts] = await Promise.all([
    prisma.user.findMany({
      where: { approved: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { approved: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isAdmin: true, createdAt: true },
    }),
  ]);

  return (
      <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Pending approvals</h2>
        <AdminApprovals
          users={pendingUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Accounts</h2>
        <AdminAccounts
          accounts={accounts.map((u) => ({
            id: u.id,
            name: u.name,
            isAdmin: u.isAdmin,
            createdAt: u.createdAt.toISOString(),
            isSelf: u.id === selfId,
          }))}
        />
      </section>
      </div>
  );
}
