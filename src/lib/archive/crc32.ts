const CRC32_POLYNOMIAL = 0xedb88320;
const BYTE_MASK = 0xff;
const TABLE_SIZE = 256;
const BITS_PER_BYTE = 8;

const buildCrcTable = (): Uint32Array => {
  const table = new Uint32Array(TABLE_SIZE);
  for (let n = 0; n < TABLE_SIZE; n++) {
    let c = n;
    for (let k = 0; k < BITS_PER_BYTE; k++) {
      c = (c & 1) === 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
};

const CRC_TABLE = buildCrcTable();

export const CRC32_INITIAL = 0xffffffff;

/**
 * Folds `data` into a running CRC-32 accumulator. Call with `CRC32_INITIAL`
 * to start, chain the returned value across chunks, then pass the final
 * value through `crc32Final` to get the ZIP-spec CRC-32.
 */
export const crc32Update = (crc: number, data: Uint8Array): number => {
  let c = crc;
  for (const byte of data) {
    const tableEntry = CRC_TABLE[(c ^ byte) & BYTE_MASK];
    c = (tableEntry ?? 0) ^ (c >>> BITS_PER_BYTE);
  }
  return c >>> 0;
};

export const crc32Final = (crc: number): number => (crc ^ 0xffffffff) >>> 0;
