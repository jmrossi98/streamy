import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSiteSettings } from "@/lib/siteSettings";
import { MAINTENANCE_PATH, showMaintenance } from "@/lib/siteSettingsRules";

/**
 * Runs in front of every page (not API routes or static files; see the
 * matcher). Next 16 renamed middleware.ts to proxy.ts and runs it on the
 * Node.js runtime, which is what lets the maintenance switch be read from the
 * database here.
 */
export async function proxy(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // `token.id` rather than `token`: the jwt callback returns an empty token to
  // invalidate a session whose password has since changed. That token is still
  // a decodable object, so checking truthiness alone would keep letting it in.
  if (token?.id) {
    // Maintenance (Admin -> Security -> Site access): everyone but an admin
    // sees the maintenance page, at the address they asked for, so a reload
    // once it is over lands them where they were going. The token's isAdmin
    // claim is enough here: this is a closed sign, not a security boundary.
    const { maintenance } = await getSiteSettings();
    if (showMaintenance(req.nextUrl.pathname, token.isAdmin === true, maintenance)) {
      return NextResponse.rewrite(new URL(MAINTENANCE_PATH, req.url));
    }
    return NextResponse.next();
  }

  const callbackUrl = req.nextUrl.pathname + req.nextUrl.search;
  // /login, not the profile picker. That page listed every approved
  // account name to anyone who asked -- a free list of valid usernames
  // for anyone trying passwords against them.
  const redirectUrl = new URL("/login", req.url);
  redirectUrl.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  // /dev and /test-assets are excluded here, not just left to the page
  // itself, so the Playwright player-control suite (playwright.config.ts)
  // can drive the harness -- and load its bundled test clip -- without a
  // real session. Public static files are not implicitly exempt from
  // middleware in Next.js; without this, requesting the clip 307-redirected
  // to the sign-in page and the <video> element failed to parse the
  // redirect target as media. Safe unauthenticated in production too: every
  // page under /dev calls notFound() itself when NODE_ENV === "production"
  // (see src/app/dev/player-harness/page.tsx), and /test-assets holds
  // nothing but that one throwaway synthetic test clip -- this only widens
  // *who can reach* those two paths, not what's actually there.
  //
  // /ruffle is the same class of miss, found while chasing "Flash games take
  // a long time to start": it holds the Flash emulator's own static runtime
  // (ruffle.js plus a multi-megabyte WASM/JS core), not game content, and had
  // no exemption -- so every load of it paid for a full JWT decode via
  // getToken() on top of the actual SWF fetch, and Next couldn't serve it as
  // a plain cacheable static file. The content this actually needs to gate
  // (the .swf itself) is unaffected: that goes through
  // /api/flash/[fileName], which checks the session itself and is not
  // exempted here.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|login|dev|test-assets|ruffle).*)",
  ],
};
