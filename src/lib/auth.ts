import { cache } from "react";
import type { NextAuthOptions } from "next-auth";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";
import { pickNextAvatarColor } from "./userAvatarColors";

/** Cached per request so multiple callers in the same render share one session fetch. */
export const getSession = cache(() => getServerSession(authOptions));

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        const name = credentials?.name?.trim();
        if (!name) return null;
        const existing = await prisma.user.findFirst({
          where: { name },
          select: { id: true, name: true, avatarColor: true },
        });
        if (existing) {
          let avatarColor = existing.avatarColor;
          if (!avatarColor) {
            avatarColor = await pickNextAvatarColor();
            await prisma.user.update({
              where: { id: existing.id },
              data: { avatarColor },
            });
          }
          return { id: existing.id, name: existing.name, avatarColor };
        }
        const avatarColor = await pickNextAvatarColor();
        const user = await prisma.user.create({
          data: { name, avatarColor },
        });
        return { id: user.id, name: user.name, avatarColor: user.avatarColor };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name ?? undefined;
        token.avatarColor = (user as { avatarColor?: string | null }).avatarColor ?? undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.avatarColor = token.avatarColor as string | undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

/**
 * JWT sessions can outlive the User row (db reset, switched DATABASE_URL, deleted user).
 * Use before Prisma writes that reference `userId` to avoid P2003 foreign key errors.
 */
export async function getValidSessionUserId(session: Session | null): Promise<string | null> {
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  return user?.id ?? null;
}

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; avatarColor?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    name?: string;
    avatarColor?: string;
  }
}
