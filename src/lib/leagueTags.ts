/**
 * The short tag a league shows as on a badge.
 *
 * Display only: the full labels in sportsSchedule.ts LEAGUES are what game and
 * stream matching compare against, so those stay as they are. Long names wrapped
 * onto two lines inside the badge on a phone -- "LA LIGA", "COLLEGE FOOTBALL"
 * (2026-10-24) -- so the long ones use their usual abbreviations.
 */
const SHORT: Record<string, string> = {
  "College Football": "NCAAF",
  "College Basketball": "NCAAB",
  "Premier League": "EPL",
  "Champions League": "UCL",
  "Formula 1": "F1",
};

export function leagueTag(league: string): string {
  return SHORT[league] ?? league;
}
