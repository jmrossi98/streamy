import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // `token.id` rather than `token`: the jwt callback returns an empty token to
  // invalidate a session whose password has since changed. That token is still
  // a decodable object, so checking truthiness alone would keep letting it in.
  if (token?.id) {
    return NextResponse.next();
  }

  const callbackUrl = req.nextUrl.pathname + req.nextUrl.search;
  const redirectUrl = new URL("/who-is-watching", req.url);
  redirectUrl.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|icon|apple-icon|login|who-is-watching).*)",
  ],
};
