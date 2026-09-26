"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";

/**
 * Whether an error from NextAuth is safe to show as-is.
 *
 * authorize() throws sentences written for the person reading them, so those
 * should reach the page intact. NextAuth's own internal codes are not:
 * "CredentialsSignin" is a state, not a sentence, and anything long enough to
 * be a stack trace is a leak rather than a message.
 */
function isPresentableError(error: string): boolean {
  if (!error || error === "CredentialsSignin") return false;
  return error.length <= 160 && !error.includes("\n");
}

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const prefillName = searchParams.get("name") ?? "";
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState(prefillName);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Require a real user id, not just the "authenticated" status. When a
    // session is invalidated server-side (a stale token whose jwt callback
    // returns an empty {}), useSession still reports "authenticated" but the
    // session carries no user.id. Redirecting on status alone bounced such a
    // user between /login and the middleware forever -- the sign-in loop. With
    // no id we fall through to the form; signing in overwrites the bad cookie.
    if (status === "authenticated" && session?.user?.id) {
      window.location.href = callbackUrl.startsWith("/") ? callbackUrl : "/";
    }
  }, [status, session, callbackUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const res = await signIn("credentials", {
      name,
      password,
      intent: mode,
      redirect: false,
      callbackUrl: callbackUrl.startsWith("/") ? callbackUrl : "/",
    });
    setLoading(false);
    if (res?.error) {
      if (res.error === "Your account is pending approval.") {
        // Deliberately not the language of email verification: nothing is
        // sent to the new user, and there is no link to click. Someone
        // waiting on a confirmation email would wait forever.
        setInfo(
          "Thanks for signing up. A request to approve your account has been sent " +
            "to the admin -- you can sign in as soon as it is approved. Nothing is " +
            "sent to your email."
        );
      } else if (res.error === "Incorrect password.") {
        // One message covers "no such name" and "wrong password" on purpose --
        // see the matching note in auth.ts. Worded for the mode the person
        // chose so it still reads as an answer to what they were doing.
        setError(
          mode === "signup"
            ? "That name is taken, or the password does not match it. Try signing in instead."
            : "That name and password do not match an account."
        );
      } else if (res.error === "Name and password are required.") {
        setError(res.error);
      } else if (isPresentableError(res.error)) {
        // The server's own words. Password-policy rejections ("Password must
        // be at least 8 characters.") arrive here, and the old catch-all
        // replaced every one of them with "Something went wrong" -- which
        // told someone whose password was simply too short to try again at
        // exactly the thing that could not work.
        setError(res.error);
      } else {
        setError("Something went wrong. Try again.");
      }
      return;
    }
    if (res?.ok) {
      window.location.href = callbackUrl.startsWith("/") ? callbackUrl : "/";
    }
  }

  // Same guard as the redirect effect: show "Redirecting" only when there is a
  // real user to redirect. An invalidated session (authenticated, no id) must
  // fall through to the form rather than sit on a redirect that loops.
  if (status === "loading" || (status === "authenticated" && session?.user?.id)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-netflix-black">
        <p className="text-white/70">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-netflix-black">
      <div className="w-full max-w-md">
        <div className="bg-netflix-dark/80 rounded-lg p-8 border border-white/10">
          {/* A real control rather than a line of prose. The form posts to
              the same place either way -- what the choice changes is the
              intent sent with it, and therefore whether an unknown name
              creates an account or is refused. */}
          <div className="mb-6 flex gap-1 rounded bg-white/5 p-1" role="tablist">
            {([
              ["signin", "Sign in"],
              ["signup", "Sign up"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  // A message about the other mode is worse than none.
                  setError("");
                  setInfo("");
                }}
                className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                  mode === value
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-2">
            {mode === "signin" ? "Welcome back" : "Create an account"}
          </h1>
          <p className="text-white/70 text-sm mb-6">
            {mode === "signin"
              ? "Enter your name and password."
              : "Pick a name and password of at least 8 characters. An admin approves new accounts before the first sign-in — nothing is emailed to you."}
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-netflix-red text-sm bg-netflix-red/10 rounded px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-white text-sm bg-white/10 rounded px-3 py-2">
                {info}
              </p>
            )}
            <div>
              <label htmlFor="name" className="block text-sm text-white/70 mb-1">
                Your name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                placeholder="e.g. Alex"
                className="w-full px-4 py-3 rounded bg-white/10 text-white placeholder-white/40 border border-white/20 focus:border-netflix-red focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm text-white/70 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded bg-white/10 text-white placeholder-white/40 border border-white/20 focus:border-netflix-red focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-netflix-red text-white font-semibold rounded hover:bg-netflix-red/90 disabled:opacity-50 transition-opacity"
            >
              {loading
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
