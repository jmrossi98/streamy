"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const { data: session, status } = useSession();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session) {
      window.location.href = callbackUrl.startsWith("/") ? callbackUrl : "/";
    }
  }, [status, session, callbackUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      name,
      redirect: false,
      callbackUrl: callbackUrl.startsWith("/") ? callbackUrl : "/",
    });
    setLoading(false);
    if (res?.error) {
      setError("Something went wrong. Try again.");
      return;
    }
    if (res?.ok) {
      window.location.href = callbackUrl.startsWith("/") ? callbackUrl : "/";
    }
  }

  if (status === "loading" || (status === "authenticated" && session)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-netflix-black">
        <p className="text-white/70">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-netflix-black">
      <div className="w-full max-w-md">
        <Link href="/who-is-watching" className="block text-center mb-8">
          <span className="text-netflix-red text-4xl font-bold tracking-tight">STREAMY</span>
        </Link>
        <div className="bg-netflix-dark/80 rounded-lg p-8 border border-white/10">
          <h1 className="font-display text-3xl font-bold text-white mb-6">Get started</h1>
          <p className="text-white/70 text-sm mb-6">
            Enter your name to track your watchlist and progress.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-netflix-red text-sm bg-netflix-red/10 rounded px-3 py-2">
                {error}
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
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-netflix-red text-white font-semibold rounded hover:bg-netflix-red/90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Continuing…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
