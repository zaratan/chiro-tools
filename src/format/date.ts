const pad2 = (n: number): string => n.toString().padStart(2, "0");

/**
 * "JJ/MM/AAAA" in local calendar fields — the French date format shown on
 * result-style screens (e.g. "Archivée le 16/08/2026"). Local-time
 * accessors deliberately, matching `buildArchiveName`'s own date handling
 * (`lib/archive/planArchive.ts`): the instant is displayed the way it reads
 * on this machine, not in UTC.
 */
export const formatDayMonthYear = (date: Date): string =>
  `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear().toString()}`;

/**
 * "JJ/MM" — day and month only, for contexts where the year is redundant
 * (e.g. "chiro archive le plus récent, celui du 14/08", naming a backup
 * from earlier the same year).
 */
export const formatDayMonth = (date: Date): string =>
  `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;

/**
 * "H h MM" local time-of-day — e.g. "2 h 47". Hour is not zero-padded
 * (matches the mockups: "2 h 47", not "02 h 47"), minutes always are.
 * Paired with a duration on the offsite ResultScreen (D4 bis of the offsite
 * plan): discovered hours after the fact, a duration alone doesn't say when
 * the run actually ended, and the time of day alone is meaningless for a
 * 17-minute run.
 */
export const formatTimeOfDay = (date: Date): string =>
  `${date.getHours().toString()} h ${pad2(date.getMinutes())}`;
