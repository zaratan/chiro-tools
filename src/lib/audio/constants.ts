/**
 * Vigie-Chiro convention: chunks span 5 s of real-time bat audio. Output is
 * always TE×10 (files recorded in TE×10 are kept as is, the others are slowed
 * down 10×), so 5 s real-time maps to 50 s on the output timeline. This
 * matches Kaleidoscope's default segmentation; producing shorter chunks
 * confuses downstream tools like ChiroSurf.
 */
export const CHUNK_OUTPUT_SECONDS = 50;
export const CHUNK_REAL_SECONDS = 5;
export const TIME_EXPANSION_FACTOR = 10;
