/**
 * Vigie-Chiro convention: chunks span 5 s of real-time bat audio. Both the
 * Teensy (records natively in time-expansion ×10) and AudioMoth pipelines
 * produce TE×10 output, so 5 s real-time always maps to 50 s on the output
 * timeline. This matches Kaleidoscope's default segmentation; producing
 * shorter chunks confuses downstream tools like Chirosuf.
 */
export const CHUNK_OUTPUT_SECONDS = 50;
export const CHUNK_REAL_SECONDS = 5;
export const TIME_EXPANSION_FACTOR = 10;

/**
 * Assumed output sample rates, used only for the pre-processing chunk-count
 * estimate that sizes the progress bar before a run starts. These are NOT
 * read from the actual WAV headers — the real splitters compute chunk
 * boundaries from the true sample count. If a detector records at a
 * different rate than assumed here (e.g. an AudioMoth configured at 192 kHz
 * instead of the standard TE×10 output), the estimate is off proportionally
 * — a 192 kHz file would be underestimated by roughly 30 %. Acceptable for
 * an approximate preview.
 */
export const PRESERVE_MODE_OUTPUT_RATE = 38400;
export const EXPAND_MODE_OUTPUT_RATE = 25000;
