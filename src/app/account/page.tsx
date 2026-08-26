import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

/**
 * Account settings. Currently just the password, which until now could not be
 * changed at all from inside the app.
 */
export default async function AccountPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/who-is-watching");

  // Read the row rather than trusting the session claim: the length floor
  // shown to the user should match the one the server will actually enforce.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, approved: true, isAdmin: true },
  });
  if (!user?.approved) redirect("/who-is-watching");

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
    </div>
  );
}
