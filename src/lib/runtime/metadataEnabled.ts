const DISABLE_METADATA_ENV = "CHIRO_DISABLE_METADATA";

/**
 * Whether GUANO + wamd metadata chunks should be appended to processed
 * output. Kill switch: set `CHIRO_DISABLE_METADATA=1` to disable, e.g. if a
 * downstream tool chokes on the wamd format — no rebuild required.
 */
export const metadataEnabled = (): boolean =>
  process.env[DISABLE_METADATA_ENV] !== "1";
