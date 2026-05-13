/**
 * Extracts the recording timestamp from a Vigie-Chiro filename.
 *
 * Both Teensy/PaRec and AudioMoth detectors embed `YYYYMMDD_HHMMSS` in the
 * filename, surrounded by underscores or directly before the extension:
 *   PaRecPR1925645_20260507_211006.wav
 *   20260507_210501T.WAV  (AudioMoth, suffix `T` for triggered)
 *
 * The regex is anchored on the surrounding `_` / `.` / start-of-name so that
 * partial dates baked into the chiro prefix (e.g. `Car340581-2026-Pass1-…`)
 * cannot match. We treat the embedded value as system-local time, matching
 * the detector convention (no timezone information is encoded).
 *
 * Returns `null` when no valid timestamp can be recovered.
 */
const TIMESTAMP_REGEX = /(?:^|[/_-])(\d{8})_(\d{6})(?=[_.A-Za-z])/;

export const parseSourceTimestamp = (filename: string): Date | null => {
  const match = TIMESTAMP_REGEX.exec(filename);
  if (match === null) return null;
  const date = match[1];
  const time = match[2];
  if (date === undefined || time === undefined) return null;

  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(4, 6), 10);
  const day = parseInt(date.slice(6, 8), 10);
  const hour = parseInt(time.slice(0, 2), 10);
  const minute = parseInt(time.slice(2, 4), 10);
  const second = parseInt(time.slice(4, 6), 10);

  if (
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const result = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(result.getTime())) return null;
  return result;
};
