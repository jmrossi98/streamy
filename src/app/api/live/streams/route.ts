import { NextResponse } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import {
  isDispatcharrConfigured,
  listPromotedStreamIds,
  listStreams,
} from "@/lib/dispatcharr";

/**
 * The provider catalogue, for the stream browser.
 *
 * Admin only. This reads the full list of everything the providers carry --
 * 4,150 entries here, most of which are not in the published lineup -- and the
 * companion POST route can add to what every viewer sees. Neither is something
 * an ordinary account should reach.
 *
 * Searching and paging are Dispatcharr's, not this route's: filtering 4,150
 * rows in the browser would mean shipping the whole catalogue per keystroke,
 * and Dispatcharr already indexes it.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await requireAdmin(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

  // Both in one wave: the promoted set is what lets the browser show "already
  // added" rather than offering a duplicate, and fetching it after the list
  // would make every page load two serial round trips to the home server.
  const [result, promoted] = await Promise.all([
    listStreams({ search, page, pageSize: 50 }),
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
    promotedIds: promoted ? [...promoted] : [],
  });
}
