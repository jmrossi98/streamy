import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import {
  isDispatcharrConfigured,
  listPromotedStreamIds,
  listStreams,
} from "@/lib/dispatcharr";

/**
 * The provider catalogue, for the stream browser.
 *
 * Any signed-in viewer, not just admins: reading the catalogue to find
 * something worth adding is the same action whoever does it, and the
 * companion POST route (promote) is open the same way now. Removing an
 * already-published channel is the one action here that stays admin-only --
 * see the demote route -- since it can interrupt someone else mid-watch.
 *
 * Searching and paging are Dispatcharr's, not this route's: filtering 4,150
 * rows in the browser would mean shipping the whole catalogue per keystroke,
 * and Dispatcharr already indexes it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isDispatcharrConfigured()) {
    return NextResponse.json(
      { error: "Dispatcharr isn't configured on the server." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? "";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const networksOnly = url.searchParams.get("networksOnly") === "1";
  // Both applied server-side now: they filter the whole matching set, not
  // the page in hand, so paging through a category actually pages it.
  const category = url.searchParams.get("category") ?? "all";
  const provider = url.searchParams.get("provider") ?? "all";

  // Both in one wave: the promoted set is what lets the browser show "already
  // added" rather than offering a duplicate, and fetching it after the list
  // would make every page load two serial round trips to the home server.
  const [result, promoted] = await Promise.all([
    listStreams({ search, page, pageSize: 50, networksOnly, category, provider }),
    listPromotedStreamIds(),
  ]);

  if (!result) {
    // Distinct from an empty catalogue on purpose: "we could not reach
    // Dispatcharr" and "the search matched nothing" have completely different
    // fixes, and collapsing them is what makes a feature feel broken rather
    // than empty.
    return NextResponse.json(
      { error: "Couldn't reach Dispatcharr." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    items: result.items,
    total: result.total,
    page,
    // Counted across everything that matched, not this page -- see StreamPage.
    categories: result.categories,
    providers: result.providers,
    // [streamId, channelId] pairs -- a plain array survives JSON where a Map
    // wouldn't, and reconstructs into one client-side with `new Map(...)`.
    // The channel id is what a "remove channel" action needs; the stream id
    // alone (the old shape here) was only ever enough to say "already added".
    promoted: promoted ? [...promoted.entries()] : [],
  });
}
