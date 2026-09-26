import { NextResponse } from "next/server";
import { isJobBoardConfigured, refreshJobPostings } from "@/lib/jobPostings";

/**
 * Polls the configured job boards.
 *
 * Secret-gated the same way the other cron endpoints are, and fails closed when
 * the secret is unset: an open endpoint here would let anyone make this box
 * poll third-party APIs on demand.
 *
 * Deliberately not on the opportunistic page-load path the download healer uses.
 * The point of this is to notice a posting quickly, which means running on a
 * schedule whether or not anyone is looking at the site.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const expected = process.env.JOB_LISTINGS_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "JOB_LISTINGS_SECRET is not set; refusing to run" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const provided =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  // Length-independent comparison is not worth it here: the secret is compared
  // as a whole string and a timing oracle on a 32-byte random value over the
  // internet is not a practical attack. Matching the other cron endpoints.
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isJobBoardConfigured()) {
    return NextResponse.json(
      { error: "JOB_BOARD_SOURCES is not set", hint: "provider:slug[:Display Name], comma or newline separated" },
      { status: 503 }
    );
  }

  const outcome = await refreshJobPostings();
  // 200 even with per-source errors: some boards being down is an expected
  // partial result, not a failed run. A caller that wants to alert on it has
  // the errors array.
  return NextResponse.json(outcome);
}
