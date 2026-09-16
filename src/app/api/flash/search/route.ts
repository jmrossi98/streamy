import { NextResponse } from "next/server";
import { getSession, getValidSessionUserId } from "@/lib/auth";
import { searchCatalog } from "@/lib/flashCatalog";
import { isFamilyFriendly, isPlayableHere, searchFlashpoint } from "@/lib/flashpoint";

/**
 * Searches for a game to play.
 *
 * Two sources, because neither alone covers the library:
 *
 *   - the generated catalogue, which is every game Andkon carries. Roughly
 *     half of them have no Flashpoint entry at all -- "The Game Game" and its
 *     sequels among them -- so a Flashpoint-only search could never find them
 *     however they were spelled, while they sat on Andkon the whole time.
 *   - Flashpoint's live search, which reaches far beyond Andkon's 4,686
 *     titles into the wider archive.
 *
 * Catalogue hits lead. They are ranked, they are known to be downloadable,
 * and they are the ones the shelves are built from. Flashpoint results follow,
 * with anything already in the catalogue removed so the same game doesn't
 * appear twice.
 *
 * Filtered to Flash: the archive also preserves Shockwave, Unity, Java and
 * HTML5 content, none of which Ruffle can play here. Also filtered for adult
 * material and for Flashpoint's `theatre` library -- the archive preserves
 * everything the Flash web had, pornography included, and an unfiltered title
 * search on a household media server surfaced exactly that.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getValidSessionUserId(await getSession()))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ results: [] });

  const local = searchCatalog(query, 40);

  // searchFlashpoint never throws -- an unreachable archive is an empty
  // result, not a failed page, and the catalogue half still answers.
  const archive = (await searchFlashpoint(query, 40)).filter(
    (g) => isPlayableHere(g) && isFamilyFriendly(g)
  );

  const seen = new Set(local.map((g) => g.id).filter((id): id is string => !!id));
  const seenTitles = new Set(local.map((g) => g.title.toLowerCase()));

  const results = [
    ...local.map((g) => ({
      id: g.id,
      andkonPath: g.andkonPath,
      title: g.title,
      developer: g.developer,
    })),
    ...archive
      .filter((g) => !seen.has(g.id) && !seenTitles.has(g.title.toLowerCase()))
      .map((g) => ({
        id: g.id,
        andkonPath: undefined,
        title: g.title,
        developer: g.developer,
        full: g,
      })),
  ];

  return NextResponse.json({ results });
}
