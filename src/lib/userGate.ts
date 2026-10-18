import { prisma } from "./db";
import { createUserGateCache } from "./userGateCache";

// One cache per server process -- see userGateCache.ts for why it exists.
const cache = createUserGateCache(async (userId) => {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { approved: true, isAdmin: true, passwordChangedAt: true, name: true },
  });
  return row ? { approved: row.approved, isAdmin: row.isAdmin, passwordChangedAt: row.passwordChangedAt, name: row.name } : null;
});

export const readUserGate = cache.read;
/** Call after approving, demoting, deleting a user or changing their password. */
export const forgetUserGate = cache.forget;
