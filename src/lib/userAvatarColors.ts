import { prisma } from "@/lib/db";

/**
 * Distinct avatar background colors (hex). New users get the first color not yet used; then we cycle.
 */
export const USER_AVATAR_COLORS = [
  "#e50914",
  "#db2777",
  "#7c3aed",
  "#2563eb",
  "#059669",
  "#d97706",
  "#ea580c",
  "#0891b2",
  "#4f46e5",
  "#be123c",
  "#65a30d",
  "#ca8a04",
  "#0d9488",
] as const;

const FALLBACK = "#6b7280";

/** Next palette color: prefer one not already assigned to any user. */
export async function pickNextAvatarColor(): Promise<string> {
  const rows = await prisma.user.findMany({
    select: { avatarColor: true },
  });
  const used = new Set(
    rows.map((r) => r.avatarColor).filter((c): c is string => c != null && c.length > 0)
  );
  const unused = USER_AVATAR_COLORS.find((c) => !used.has(c));
  if (unused) return unused;
  const n = rows.filter((r) => r.avatarColor != null).length;
  return USER_AVATAR_COLORS[n % USER_AVATAR_COLORS.length] ?? FALLBACK;
}

export function avatarColorOrFallback(color: string | null | undefined): string {
  if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;
  return FALLBACK;
}
