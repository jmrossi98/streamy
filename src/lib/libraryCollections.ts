/**
 * The keyword collections the browse pages can shelve the library by.
 *
 * Genre says a film is an action film; only TMDB's keywords say it is a
 * heist, or set in space, or a true story. A collection names a handful of
 * keywords that mean the same thing, and the row holds every downloaded title
 * tagged with any of them. Only collections with enough titles become rows
 * (see MIN_FEATURE_ROW), so a small library shows few of these and a large one
 * many.
 *
 * Keywords are TMDB's own strings, lowercase, matched whole. Shared by movies
 * and shows; a collection with nothing of one kind simply has no row there.
 * Order is the order rows appear in, deliberate rather than alphabetical.
 */
import type { Collection } from "./libraryRowRules";

export const COLLECTIONS: Collection[] = [
  {
    slug: "true-story",
    title: "Based on a True Story",
    keywords: ["based on true story", "biography", "based on true events", "biopic"],
  },
  {
    slug: "superheroes",
    title: "Superheroes",
    keywords: ["superhero", "marvel cinematic universe (mcu)", "dc comics", "marvel comics", "based on comic", "superhero team"],
  },
  {
    slug: "space",
    title: "Out in Space",
    keywords: ["space", "outer space", "space travel", "astronaut", "spacecraft", "space opera", "space station"],
  },
  { slug: "heists", title: "Heists", keywords: ["heist", "robbery", "bank robbery", "con artist", "thief"] },
  { slug: "time-travel", title: "Time Travel", keywords: ["time travel", "time loop", "alternate timeline"] },
  { slug: "spies", title: "Spies", keywords: ["spy", "espionage", "secret agent", "cia", "mi6", "secret service"] },
  { slug: "zombies", title: "Zombies", keywords: ["zombie", "zombie apocalypse", "undead"] },
  {
    slug: "monsters",
    title: "Monsters",
    keywords: ["monster", "kaiju", "giant monster", "creature feature", "dinosaur"],
  },
  { slug: "vampires-werewolves", title: "Vampires & Werewolves", keywords: ["vampire", "werewolf", "dracula"] },
  {
    slug: "mob",
    title: "Gangsters & the Mob",
    keywords: ["gangster", "mafia", "organized crime", "mob", "mob boss", "crime family"],
  },
  { slug: "serial-killers", title: "Serial Killers", keywords: ["serial killer", "serial murder"] },
  {
    slug: "dystopia",
    title: "Dystopias",
    keywords: ["dystopia", "post-apocalyptic future", "post-apocalypse", "totalitarian regime", "apocalypse"],
  },
  {
    slug: "mind-benders",
    title: "Mind-Benders",
    keywords: ["psychological thriller", "plot twist", "surrealism", "mindbender", "unreliable narrator", "memory loss", "amnesia"],
  },
  { slug: "road-trips", title: "Road Trips", keywords: ["road trip", "road movie", "cross-country"] },
  { slug: "coming-of-age", title: "Coming of Age", keywords: ["coming of age", "teenager", "high school", "adolescence"] },
  {
    slug: "martial-arts",
    title: "Martial Arts",
    keywords: ["martial arts", "kung fu", "karate", "samurai", "ninja"],
  },
  {
    slug: "sports",
    title: "Sports",
    keywords: ["sports", "boxing", "baseball", "basketball", "american football", "soccer", "wrestling", "hockey", "underdog"],
  },
  { slug: "courtroom", title: "Courtroom", keywords: ["courtroom", "trial", "lawyer", "legal drama", "jury"] },
  { slug: "video-games", title: "From Video Games", keywords: ["based on video game", "video game", "gamer", "virtual reality"] },
  {
    slug: "books",
    title: "From the Page",
    keywords: ["based on novel or book", "based on young adult novel", "based on short story", "based on play or musical"],
  },
  { slug: "found-footage", title: "Found Footage", keywords: ["found footage", "mockumentary"] },
  { slug: "cult", title: "Cult Favorites", keywords: ["cult film", "cult classic", "midnight movie", "b movie"] },
  { slug: "workplace", title: "At Work", keywords: ["workplace", "workplace comedy", "office", "sitcom", "coworker relationship"] },
  {
    slug: "police",
    title: "Cops & Detectives",
    keywords: ["police", "detective", "police procedural", "police detective", "murder investigation", "fbi"],
  },
  { slug: "hospital", title: "Doctors & Hospitals", keywords: ["hospital", "medical drama", "surgeon", "emergency room"] },
  { slug: "animals", title: "Animals", keywords: ["dog", "cat", "talking animal", "anthropomorphism", "animal", "horse", "shark"] },
];

export function collectionBySlug(slug: string): Collection | null {
  return COLLECTIONS.find((c) => c.slug === slug) ?? null;
}
