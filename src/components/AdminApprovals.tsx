"use client";

import { useState } from "react";

type PendingUser = { id: string; name: string; createdAt: string };

export function AdminApprovals({ users }: { users: PendingUser[] }) {
  const [pending, setPending] = useState(users);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(userId: string, action: "approve" | "deny") {
    setBusyId(userId);
    try {
      const res = await fetch("/api/admin/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        window.alert(data.error ?? "Something went wrong.");
        return;
      }
      setPending((prev) => prev.filter((u) => u.id !== userId));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen px-4 sm:px-6 pt-24 pb-16 max-w-2xl mx-auto">
      <h1 className="font-display text-3xl font-bold text-white mb-6">Pending approvals</h1>
      {pending.length === 0 ? (
        <p className="text-white/60">No pending signups.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((user) => (
            <li
              key={user.id}
              className="flex items-center justify-between gap-4 bg-netflix-dark/80 border border-white/10 rounded-lg px-4 py-3"
            >
              <div>
                <p className="text-white font-medium">{user.name}</p>
                <p className="text-white/50 text-xs">
                  Requested {new Date(user.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => void act(user.id, "approve")}
                  className="px-3 py-1.5 rounded bg-netflix-red text-white text-sm font-medium hover:bg-netflix-red/90 disabled:opacity-50 transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === user.id}
                  onClick={() => void act(user.id, "deny")}
                  className="px-3 py-1.5 rounded border border-white/20 text-white/80 text-sm font-medium hover:bg-white/10 disabled:opacity-50 transition-colors"
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
