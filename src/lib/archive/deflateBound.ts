/**
 * zlib's unconditional worst-case bound on a raw-deflate output size for `n`
 * input bytes — NOT the tight `compressBound` formula (`n + n/12 + ...`),
 * which is only valid for the default `windowBits: 15` / `memLevel: 8` and
 * is exceeded by `level: 1` (+456 KB on 8 MiB), `memLevel: 1`, and
 * `windowBits: 9` — verified empirically. This one holds for every
 * configuration this project might ever pass to `createDeflateRaw`.
 */
export const deflateBound = (n: number): number =>
  n + Math.ceil((n + 7) / 8) + Math.ceil((n + 63) / 64) + 5;
