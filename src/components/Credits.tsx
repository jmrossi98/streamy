import Image from "next/image";
import Link from "next/link";
import type { Credits as CreditsData, CrewMember } from "@/lib/tmdb";

// Cast + key crew for a title page, in the spirit of IMDb/Letterboxd: a row of
// cast headshots, then director/writer/producer credits. Renders nothing when
// TMDB has no people for the title, so callers can drop it in unconditionally.
// Every name links to /person/[id] -- their filmography, in the same layout
// as everywhere else on the site.
export function Credits({ credits }: { credits?: CreditsData }) {
  if (!credits) return null;
  const { cast, director, writer, producer } = credits;
  const crew: { label: string; people: CrewMember[] }[] = [
    { label: director.length > 1 ? "Directors" : "Director", people: director },
    { label: writer.length > 1 ? "Writers" : "Writer", people: writer },
    { label: producer.length > 1 ? "Producers" : "Producer", people: producer },
  ].filter((c) => c.people.length > 0);

  if (cast.length === 0 && crew.length === 0) return null;

  return (
    <section className="space-y-6" aria-label="Cast and crew">
      {cast.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-white text-lg font-semibold">Cast</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-thin">
            {cast.map((person) => (
              <Link
                key={person.id}
                href={`/person/${person.id}`}
                className="w-[92px] shrink-0 text-center group"
              >
                <div className="relative mb-2 h-[92px] w-[92px] overflow-hidden rounded-full bg-netflix-dark ring-1 ring-white/10 transition-shadow group-hover:ring-white/40">
                  {person.profile ? (
                    <Image
                      src={person.profile}
                      alt={person.name}
                      fill
                      className="object-cover"
                      sizes="92px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl text-white/30">
                      {person.name.charAt(0)}
                    </div>
                  )}
                </div>
                <p className="text-white text-xs font-medium leading-tight line-clamp-2 group-hover:underline">
                  {person.name}
                </p>
                {person.character && (
                  <p className="text-white/50 text-[11px] leading-tight line-clamp-2 mt-0.5">
                    {person.character}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {crew.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {crew.map((row) => (
            <div key={row.label} className="flex gap-3 border-b border-white/10 pb-3">
              <dt className="w-24 shrink-0 text-white/50 text-sm">{row.label}</dt>
              <dd className="text-white/90 text-sm">
                {row.people.map((person, i) => (
                  <span key={person.id}>
                    {i > 0 && ", "}
                    <Link href={`/person/${person.id}`} className="hover:underline hover:text-white">
                      {person.name}
                    </Link>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
