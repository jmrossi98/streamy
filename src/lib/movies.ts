export type Movie = {
  id: string;
  title: string;
  overview: string;
  poster: string;
  backdrop: string;
  year: string;
  rating: number;
  duration: string;
  genres: string[];
  featured?: boolean;
};

export const genres = [
  "Action",
  "Comedy",
  "Drama",
  "Horror",
  "Sci-Fi",
  "Documentaries",
  "Romance",
  "Thriller",
];

export const movies: Movie[] = [
  {
    id: "1",
    title: "The Midnight Run",
    overview:
      "A former detective is pulled back for one last job when a notorious criminal escapes. As the clock ticks, he must navigate a web of corruption to save the city.",
    poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400",
    backdrop: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920",
    year: "2024",
    rating: 8.2,
    duration: "2h 14m",
    genres: ["Action", "Thriller"],
    featured: true,
  },
  {
    id: "2",
    title: "Echoes of Tomorrow",
    overview:
      "In a world where memories can be relived, a woman discovers that her past holds the key to saving humanity from a silent collapse.",
    poster: "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=400",
    backdrop: "https://images.unsplash.com/photo-1440404653323-ab43d7d2d2fc?w=1920",
    year: "2024",
    rating: 7.9,
    duration: "2h 8m",
    genres: ["Sci-Fi", "Drama"],
    featured: true,
  },
  {
    id: "3",
    title: "Laugh Factory",
    overview:
      "When a struggling comedian's joke goes viral for the wrong reasons, she must navigate fame, family, and the fine line between truth and comedy.",
    poster: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400",
    backdrop: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1920",
    year: "2023",
    rating: 7.5,
    duration: "1h 42m",
    genres: ["Comedy", "Drama"],
  },
  {
    id: "4",
    title: "Shadow Protocol",
    overview:
      "Elite operatives uncover a conspiracy that reaches the highest levels of government. Trust no one.",
    poster: "https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=400",
    backdrop: "https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=1920",
    year: "2024",
    rating: 8.0,
    duration: "2h 22m",
    genres: ["Action", "Thriller"],
  },
  {
    id: "5",
    title: "The Last Letter",
    overview:
      "A love story spanning decades, told through letters that were never sent. Two souls connected across time and distance.",
    poster: "https://images.unsplash.com/photo-1524712245354-2c4e5e7121c0?w=400",
    backdrop: "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=1920",
    year: "2023",
    rating: 7.8,
    duration: "1h 56m",
    genres: ["Romance", "Drama"],
  },
  {
    id: "6",
    title: "Dark Matter",
    overview:
      "Scientists at the edge of the universe make a discovery that could rewrite the laws of physics—or destroy them.",
    poster: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400",
    backdrop: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920",
    year: "2024",
    rating: 8.5,
    duration: "2h 35m",
    genres: ["Sci-Fi", "Thriller"],
  },
  {
    id: "7",
    title: "Haunting at Blackwood",
    overview:
      "A family moves into an ancestral estate only to find that the house has been waiting for them—and it has a long memory.",
    poster: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=400",
    backdrop: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920",
    year: "2023",
    rating: 6.9,
    duration: "1h 48m",
    genres: ["Horror", "Thriller"],
  },
  {
    id: "8",
    title: "Planet of the Past",
    overview:
      "Documentary crew embarks on a journey to document the last untouched ecosystems before they vanish forever.",
    poster: "https://images.unsplash.com/photo-1453928582365-b6ad33cbcf64?w=400",
    backdrop: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920",
    year: "2024",
    rating: 8.7,
    duration: "1h 52m",
    genres: ["Documentaries"],
  },
  {
    id: "9",
    title: "Velocity",
    overview:
      "A street racer is forced to run one final race to save her brother—but the finish line might be a trap.",
    poster: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400",
    backdrop: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920",
    year: "2023",
    rating: 7.2,
    duration: "1h 58m",
    genres: ["Action"],
  },
  {
    id: "10",
    title: "Summer of '99",
    overview:
      "Four friends spend one last summer together before life pulls them apart. A coming-of-age story about loyalty and change.",
    poster: "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=400",
    backdrop: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920",
    year: "2023",
    rating: 7.6,
    duration: "1h 44m",
    genres: ["Drama", "Romance"],
  },
];

export function getFeaturedMovie(): Movie | undefined {
  return movies.find((m) => m.featured);
}

export function getMoviesByGenre(genre: string): Movie[] {
  if (!genre) return movies;
  return movies.filter((m) => m.genres.includes(genre));
}

export function getMovieById(id: string): Movie | undefined {
  return movies.find((m) => m.id === id);
}
