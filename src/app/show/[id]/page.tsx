import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getShowById, getSeason } from "@/lib/tmdb";
import { ShowContent } from "./ShowContent";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ season?: string }>;
};

export default async function ShowPage({ params, searchParams }: Props) {
  const { id } = await params;
  const rawSearch = searchParams != null ? await Promise.resolve(searchParams).catch(() => ({})) : {};
  const resolvedSearch = (typeof rawSearch === "object" && rawSearch !== null ? rawSearch : {}) as {
    season?: string;
  };
  const initialSeasonNum = Math.min(
    Math.max(1, parseInt(resolvedSearch.season ?? "1", 10) || 1),
    999
  );

  const session = await getSession();
  const [show, season1, initialSeasonDataRaw, episodeProgressList, latestProgress, watchlistShowItem] =
    await Promise.all([
      getShowById(id),
      getSeason(id, 1),
      initialSeasonNum === 1 ? null : getSeason(id, initialSeasonNum),
      session?.user?.id
        ? prisma.episodeProgress.findMany({
            where: { userId: session.user.id, showId: id },
            orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
          })
        : [],
      session?.user?.id
        ? prisma.episodeProgress.findFirst({
            where: { userId: session.user.id, showId: id },
            orderBy: { updatedAt: "desc" },
          })
        : null,
      session?.user?.id
        ? prisma.watchlistShowItem.findUnique({
            where: { userId_showId: { userId: session.user.id, showId: id } },
          })
        : null,
    ]);
  if (!show) notFound();
  if (!season1) notFound();

  let resumeSeason = 1;
  let resumeEpisode = 1;
  let resumeEpisodeName: string | undefined;
  if (latestProgress) {
    resumeSeason = latestProgress.seasonNumber;
    resumeEpisode = latestProgress.episodeNumber;
  }

  const seasonByNum = new Map<number, Awaited<ReturnType<typeof getSeason>>>();
  seasonByNum.set(1, season1);
  if (initialSeasonNum !== 1 && initialSeasonDataRaw) seasonByNum.set(initialSeasonNum, initialSeasonDataRaw);
  if (resumeSeason !== 1 && !seasonByNum.has(resumeSeason)) {
    const resumeSeasonData = await getSeason(id, resumeSeason);
    if (resumeSeasonData) seasonByNum.set(resumeSeason, resumeSeasonData);
  }

  if (latestProgress) {
    if (resumeSeason === 1) {
      resumeEpisodeName = season1.episodes.find((e) => e.episodeNumber === resumeEpisode)?.name;
    } else {
      const resumeSeasonData = seasonByNum.get(resumeSeason);
      resumeEpisodeName = resumeSeasonData?.episodes.find(
        (e) => e.episodeNumber === resumeEpisode
      )?.name;
    }
  } else if (season1.episodes.length > 0) {
    resumeEpisode = season1.episodes[0].episodeNumber;
    resumeEpisodeName = season1.episodes[0].name;
  }

  const resumePlayLabel = resumeEpisodeName
    ? `Play S${resumeSeason} E${resumeEpisode} · ${resumeEpisodeName}`
    : `Play S${resumeSeason} E${resumeEpisode}`;

  const resumeProgressSeconds =
    latestProgress?.seasonNumber === resumeSeason && latestProgress?.episodeNumber === resumeEpisode
      ? latestProgress.progressSeconds
      : 0;

  const initialSeasonData = seasonByNum.get(initialSeasonNum) ?? season1;

  return (
    <ShowContent
      show={show}
      initialSeason={season1}
      initialSeasonNum={initialSeasonNum}
      initialSeasonData={initialSeasonData}
      episodeProgress={episodeProgressList}
      initialInList={!!watchlistShowItem}
      resumePlayHref={`/show/${id}/episode/${resumeSeason}/${resumeEpisode}`}
      resumePlayLabel={resumePlayLabel}
      resumeSeason={resumeSeason}
      resumeEpisode={resumeEpisode}
      resumeEpisodeName={resumeEpisodeName ?? ""}
      resumeProgressSeconds={resumeProgressSeconds}
    />
  );
}
