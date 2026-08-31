import { notFound } from "next/navigation";
import Image from "next/image";
import { getPersonById, getPersonCredits } from "@/lib/tmdb";
import { MovieRow } from "@/components/MovieRow";
import { TVRow } from "@/components/TVRow";
import { BROWSE_PAGE_CLASS } from "@/lib/browseLayout";

type Props = { params: Promise<{ id: string }> };

const FALLBACK_PHOTO = "https://placehold.co/500x750/1a1a1a/666?text=No+Photo";

function formatBirthday(birthday: string | null, placeOfBirth: string | null): string | null {
  if (!birthday) return placeOfBirth;
  const date = new Date(birthday + "T00:00:00");
  const formatted = Number.isNaN(date.getTime())
    ? birthday
    : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return placeOfBirth ? `${formatted} · ${placeOfBirth}` : formatted;
}

export default async function PersonPage({ params }: Props) {
  const { id } = await params;
  const [person, credits] = await Promise.all([getPersonById(id), getPersonCredits(id)]);
  if (!person) notFound();

  const meta = formatBirthday(person.birthday, person.placeOfBirth);

  return (
    <div className={BROWSE_PAGE_CLASS}>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 md:px-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="relative mx-auto h-[240px] w-[160px] shrink-0 overflow-hidden rounded-lg bg-netflix-dark ring-1 ring-white/10 sm:mx-0">
            <Image
              src={person.photo ?? FALLBACK_PHOTO}
              alt={person.name}
              fill
              className="object-cover"
              sizes="160px"
              unoptimized={!person.photo}
            />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h1 className="font-display text-2xl font-bold text-white sm:text-3xl md:text-4xl">
              {person.name}
            </h1>
            {person.knownFor && <p className="mt-1 text-sm text-white/50">{person.knownFor}</p>}
            {meta && <p className="mt-1 text-sm text-white/50">{meta}</p>}
            {person.biography && (
              <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-white/80 sm:text-base">
                {person.biography}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-10 space-y-2 [&>*:first-child]:pt-0">
        {credits.movies.length > 0 && <MovieRow title="Movies" movies={credits.movies} />}
        {credits.shows.length > 0 && <TVRow title="TV Shows" shows={credits.shows} />}
      </div>

      {credits.movies.length === 0 && credits.shows.length === 0 && (
        <p className="mx-auto max-w-5xl px-4 py-10 text-center text-white/50 sm:px-6 md:px-10">
          No known filmography.
        </p>
      )}
    </div>
  );
}
