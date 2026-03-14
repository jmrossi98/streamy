import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";

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
        });
        if (existing) {
          return { id: existing.id, name: existing.name };
        }
        const user = await prisma.user.create({
          data: { name },
        });
        return { id: user.id, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    name?: string;
  }
}
