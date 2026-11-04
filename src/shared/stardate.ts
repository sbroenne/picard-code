/**
 * A TNG-style stardate, using the common fan formula: 1000 stardate units per year, counted from
 * the year 2323. The show never gave an official conversion; dates before 2323 are negative.
 */
export function stardate(date: Date) {
  const year = date.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return 1000 * (year - 2323) + (1000 * (date.getTime() - start)) / (end - start);
}

/** The stardate with one decimal, as shown on screen, for example "-296168.3". */
export function formatStardate(date: Date) {
  return stardate(date).toFixed(1);
}

/** The Captain's log group heading: the whole part of the stardate shown on the entry. */
export function stardateGroup(date: Date) {
  return `Stardate ${Math.trunc(Number(formatStardate(date)))}`;
}
