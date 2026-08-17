/**
 * Reference throughput used to turn an archive's size into the "Durée prévue"
 * line of the confirmation screen.
 *
 * Bandwidth stopped being a *design* criterion after D4 bis of the offsite
 * plan — the target usage is launching before going to sleep, so nothing
 * branches on how long the transfer takes. The shown estimate still has to
 * track the file, though: a fixed "environ 1 h 10" printed above a 3 MB zip
 * is visibly wrong, and an estimate the user can catch out once is one she
 * stops believing.
 *
 * The value is deliberately *not* the dev's own measured throughput
 * (114 Mb/s sustained ⇒ 15 GB in ~19 min): that was measured on a wired-grade
 * connection, and the plan expects Manon's wifi to be slower. 30 Mb/s puts a
 * 15 GB archive at a little over an hour, which is the pessimistic end.
 * Overshooting is the safe direction — an archive that finishes early is a
 * good surprise, one that runs twice as long as announced is not.
 *
 * Recalibrate after the first real overnight archive, not by re-measuring in
 * isolation. The "(selon votre connexion)" parenthetical already tells her
 * this is a ballpark.
 */
export const REFERENCE_UPLOAD_BYTES_PER_SECOND = 3_750_000;

/**
 * Estimated wall-clock seconds to upload `bytes`, floored at 60 so the screen
 * never announces a duration shorter than the round trip it takes to start.
 */
export const estimateUploadSeconds = (bytes: number): number =>
  Math.max(60, Math.round(bytes / REFERENCE_UPLOAD_BYTES_PER_SECOND));
