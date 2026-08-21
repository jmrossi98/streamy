import { cache } from "react";
import type { NextAuthOptions } from "next-auth";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
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
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const name = credentials?.name?.trim();
        const password = credentials?.password ?? "";
        if (!name || !password) {
          throw new Error("Name and password are required.");
        }

        const existing = await prisma.user.findFirst({
          where: { name },
          select: { id: true, name: true, avatarColor: true, password: true, approved: true },
        });

        if (!existing) {
          const isAdmin = name === process.env.ADMIN_NAME;
          const hashed = await bcrypt.hash(password, 10);
          const avatarColor = await pickNextAvatarColor();
          const user = await prisma.user.create({
            data: { name, password: hashed, approved: isAdmin, avatarColor },
          });
          if (!isAdmin) {
            throw new Error("Your account is pending approval.");
          }
          return { id: user.id, name: user.name, avatarColor: user.avatarColor };
        }

        const valid = await bcrypt.compare(password, existing.password);
        if (!valid) {
          throw new Error("Incorrect password.");
        }
        if (!existing.approved) {
          throw new Error("Your account is pending approval.");
        }

        return { id: existing.id, name: existing.name, avatarColor: existing.avatarColor };
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
      // Recomputed every request (not just at sign-in) so an ADMIN_NAME
      // change takes effect on the admin's next request, not just next login.
      token.isAdmin = token.name === process.env.ADMIN_NAME;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.avatarColor = token.avatarColor as string | undefined;
        session.user.isAdmin = token.isAdmin as boolean;
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
    user: { id: string; name: string; avatarColor?: string | null; isAdmin?: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    name?: string;
    avatarColor?: string;
    isAdmin?: boolean;
  }
}
