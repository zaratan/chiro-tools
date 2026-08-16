const segmenter = new Intl.Segmenter("fr", { granularity: "grapheme" });

/**
 * Number of terminal columns a string occupies, for the plain text this app
 * renders (no emoji, no CJK).
 *
 * Counts *graphemes*, not code points: macOS stores filenames in NFD, so an
 * accented character in a real path arrives as `e` + a combining accent —
 * two code points, one column. Measuring code points would over-trim every
 * path containing an accent, which is most of hers.
 */
export const columnWidth = (text: string): number => {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
};

/**
 * Trims a path to `max` columns, keeping its tail.
 *
 * The tail is what identifies the folder for her ("…/Vigie-Chiro/Carre
 * 340581/Point A1"); the leading `/Users/marie-christine/Documents` is
 * identical on every screen and carries nothing. A real macOS path runs past
 * 80 columns, and Ink would wrap it on a *space* — "Saison 2026" split across
 * two rows, with nothing marking the second as a continuation.
 */
export const fitPath = (p: string, max: number): string => {
  const graphemes = [...segmenter.segment(p)].map((s) => s.segment);
  if (graphemes.length <= max) return p;
  return `…${graphemes.slice(-(max - 1)).join("")}`;
};
