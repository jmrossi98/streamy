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

  // Same fixed height as the populated list, so the widget does not change
  // size when the queue empties -- the panels beside it would otherwise jump
  // every time a signup is approved.
  if (pending.length === 0) {
    return <p className="h-72 text-sm text-white/60">No pending signups.</p>;
  }

  return (
    // Fixed height, not max-height: a queue of two and a queue of twenty
    // should occupy the same space, so this widget lines up with the ones
    // next to it instead of reflowing the panel as the list changes.
    <ul className="h-72 space-y-3 overflow-y-auto pr-1">
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
  );
}
