import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminApprovals } from "@/components/AdminApprovals";

export default async function AdminApprovalsPage() {
  const session = await getSession();
  if (!session?.user?.isAdmin) {
    redirect("/");
  }

  const pendingUsers = await prisma.user.findMany({
    where: { approved: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  return (
    <AdminApprovals
      users={pendingUsers.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
    />
  );
}
