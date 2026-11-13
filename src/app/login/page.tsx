import { getSiteSettings } from "@/lib/siteSettings";
import { LoginForm } from "./LoginForm";

/**
 * Sign in (and sign up, while it's open). The site switches are read here on
 * the server so the form never shows a Sign up tab it would then refuse.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { signupsOpen, maintenance } = await getSiteSettings();
  return <LoginForm signupsOpen={signupsOpen} maintenance={maintenance} />;
}
