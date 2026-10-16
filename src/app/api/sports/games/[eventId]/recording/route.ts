import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { logAudit } from "@/lib/auditLog";
import { formatFileSize } from "@/lib/formatBytes";
import { checkRecording, grabRecording } from "@/lib/sportarr";

/**
 * One game's recording.
 *
 *   GET  -- "Check for recording": searches the indexers (cached for hours;
 *           `?fresh=1` asks again) and answers with the game's new status.
 *   POST -- "Download": grabs the best release. Sportarr is unmonitored on
 *           purpose, so this is the only way a game ever downloads, and who
 *           asked for it is recorded.
 *
 * Both are signed-in rather than admin-only, as the Request button on a
 * movie is: a household member asking for last night's game is the point.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ eventId: string }> };

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request, { params }: Props) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const eventId = parseId((await params).eventId);
  if (eventId == null) return NextResponse.json({ error: "Bad game id" }, { status: 400 });

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const result = await checkRecording(eventId, { fresh });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ game: result.game });
}

export async function POST(_request: Request, { params }: Props) {
  const session = await getSession();
  if (!(await getValidSessionUserId(session))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const eventId = parseId((await params).eventId);
  if (eventId == null) return NextResponse.json({ error: "Bad game id" }, { status: 400 });

  const result = await grabRecording(eventId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { release, game } = result;
  logAudit(
    session?.user?.name ?? "unknown",
    "sports.recording.download",
    `${game.league}: ${game.title}`,
    [release.title, release.quality, formatFileSize(release.sizeBytes), release.indexer].filter(Boolean).join(" · ")
  );
  return NextResponse.json({ game });
}
