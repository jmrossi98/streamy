"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";

type User = { id: string; name: string };

export function WhoIsWatching({
  users,
  callbackUrl,
}: {
  users: User[];
  callbackUrl?: string;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const destination = callbackUrl || "/";

  const handleSelectUser = async (user: User) => {
    setLoadingId(user.id);
    try {
      const res = await signIn("credentials", {
        name: user.name,
        redirect: false,
        callbackUrl: destination,
      });
      if (res?.ok) {
        setTimeout(() => {
          window.location.href = destination;
        }, 400);
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
      <h1 className="font-display text-4xl md:text-5xl font-bold text-white text-center mb-12">
        Who is watching?
      </h1>
      <div className="flex flex-wrap justify-center gap-6 md:gap-8 max-w-4xl">
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => handleSelectUser(user)}
            disabled={loadingId !== null}
            className="group flex flex-col items-center gap-3 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
          >
            <span
              className="w-24 h-24 md:w-32 md:h-32 rounded-lg bg-netflix-dark border-2 border-transparent group-hover:border-white flex items-center justify-center text-4xl md:text-5xl font-bold text-white transition-colors"
              aria-hidden
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-white/80 group-hover:text-white text-lg transition-colors">
              {user.name}
            </span>
            {loadingId === user.id && (
              <span className="text-white/60 text-sm">Signing in…</span>
            )}
          </button>
        ))}
        <Link
          href={callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
          className="group flex flex-col items-center gap-3 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
        >
          <span
            className="w-24 h-24 md:w-32 md:h-32 rounded-lg bg-white/10 border-2 border-transparent group-hover:border-white flex items-center justify-center transition-colors"
            aria-hidden
          >
            <svg
              className="w-10 h-10 md:w-12 md:h-12 text-white/70 group-hover:text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </span>
          <span className="text-white/80 group-hover:text-white text-lg transition-colors">
            Add profile
          </span>
        </Link>
      </div>
    </div>
  );
}
