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
  // /dev and /test-assets are excluded here, not just left to the page
  // itself, so the Playwright player-control suite (playwright.config.ts)
  // can drive the harness -- and load its bundled test clip -- without a
  // real session. Public static files are not implicitly exempt from
  // middleware in Next.js; without this, requesting the clip 307-redirected
  // to /who-is-watching and the <video> element failed to parse the
  // redirect target as media. Safe unauthenticated in production too: every
  // page under /dev calls notFound() itself when NODE_ENV === "production"
  // (see src/app/dev/player-harness/page.tsx), and /test-assets holds
  // nothing but that one throwaway synthetic test clip -- this only widens
  // *who can reach* those two paths, not what's actually there.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|icon|apple-icon|login|who-is-watching|dev|test-assets).*)",
  ],
};
