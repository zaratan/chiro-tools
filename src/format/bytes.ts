const BYTES_PER_KB = 1024;

/**
 * Formats a byte count for display, French-locale decimal comma (e.g.
 * "1,4 Go" rather than "1.4 Go") — the only bucket with a fractional part.
 *
 * Each bucket is left before its rounded value would read as the next one:
 * 1 048 570 octets rounds to "1024 Ko", a number no reader expects to see.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < BYTES_PER_KB) {
    return bytes === 1 ? "1 octet" : `${bytes.toString()} octets`;
  }
  const kb = bytes / BYTES_PER_KB;
  if (Math.round(kb) < BYTES_PER_KB) return `${kb.toFixed(0)} Ko`;
  const mb = kb / BYTES_PER_KB;
  if (Math.round(mb) < BYTES_PER_KB) return `${mb.toFixed(0)} Mo`;
  const gb = mb / BYTES_PER_KB;
  return `${gb.toFixed(1).replace(".", ",")} Go`;
};
