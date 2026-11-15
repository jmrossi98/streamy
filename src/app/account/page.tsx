import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { DeleteProfileSection } from "@/components/DeleteProfileSection";
import { JellyfinAppCard } from "@/components/JellyfinAppCard";
import { WatchHistory } from "@/components/WatchHistory";
import { canDeleteOwnProfile, OWN_PROFILE_REFUSALS } from "@/lib/accountDeletion";
import { JELLYFIN_APP_ADDRESS_DEFAULT, jellyfinPasswordIsStreamys } from "@/lib/jellyfinAccountRules";

/**
 * Account settings: the password, how to sign in to the Jellyfin apps, the
 * person's own watch history, and deleting their profile. Open to every
 * approved account, each seeing only its own.
 */
export default async function AccountPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  // Read the row rather than trusting the session claim: the length floor
  // shown to the user should match the one the server will actually enforce.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      approved: true,
      isAdmin: true,
      jellyfinUserId: true,
      jellyfinPasswordSyncedAt: true,
      passwordChangedAt: true,
    },
  });
  if (!user?.approved) redirect("/login");
  const jellyfinAddress = process.env.JELLYFIN_PUBLIC_URL?.trim() || JELLYFIN_APP_ADDRESS_DEFAULT;
  const adminCount = user.isAdmin ? await prisma.user.count({ where: { isAdmin: true } }) : 0;
  const deleteVerdict = canDeleteOwnProfile(user, adminCount);
  const deleteBlocked = deleteVerdict.ok ? null : (OWN_PROFILE_REFUSALS[deleteVerdict.reason] ?? null);

  return (
    <div className="min-h-screen max-w-lg mx-auto px-4 sm:px-6 pt-24 pb-16 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-white">Account</h1>
        <p className="mt-1 text-sm text-white/50">
          Signed in as {user.name}
          {user.isAdmin ? " · admin" : ""}
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-white">Change password</h2>
        <div className="rounded-lg border border-white/10 bg-netflix-dark/80 px-4 py-5 sm:px-6">
          <ChangePasswordForm isAdmin={user.isAdmin} />
        </div>
      </section>

      <JellyfinAppCard address={jellyfinAddress} username={user.name} passwordReady={jellyfinPasswordIsStreamys(user)} />

      <section>
        <h2 className="mb-1 text-lg font-semibold text-white">Watch history</h2>
        <p className="mb-4 text-sm text-white/50">
          What you have watched and when you last watched it. Removing an entry also forgets where you left off.
        </p>
        <WatchHistory />
      </section>

      <DeleteProfileSection userId={session.user.id} name={user.name} blockedReason={deleteBlocked} />
    </div>
  );
}
