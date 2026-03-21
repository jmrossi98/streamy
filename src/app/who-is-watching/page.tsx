import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { WhoIsWatching } from "@/components/WhoIsWatching";

type Props = { searchParams: Promise<{ callbackUrl?: string }> };

export default async function WhoIsWatchingPage({ searchParams }: Props) {
  const session = await getSession();
  if (session?.user?.id) {
    const { callbackUrl } = await searchParams;
    redirect(callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/");
  }

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, avatarColor: true },
  });

  const { callbackUrl } = await searchParams;
  return (
    <WhoIsWatching
      users={users}
      callbackUrl={callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : undefined}
    />
  );
}
