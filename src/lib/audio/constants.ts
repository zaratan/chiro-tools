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
