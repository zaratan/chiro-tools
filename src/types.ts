export type ConstatCounts = {
  totalWav: number;
  alreadyPrefixed: number;
  upperCaseWav: number;
  otherIgnored: number;
};

export type FormInput = {
  squareCode: string;
  year: number;
  passNumber: number;
  pointCode: string;
};

export type Action = "vigie-prefix" | "vigie-process";

export type TimeExpansionMode = "preserve" | "expand-10x";

export type ProcessInput = {
  mode: TimeExpansionMode;
};

/**
 * Metadata configuration for chunk output. When `enabled`, every chunk gets
 * `wamd` and `guan` (GUANO) RIFF chunks appended after the audio data — this
 * matches Kaleidoscope's behaviour and is required for downstream tools like
 * Chirosuf to interpret the time-expansion factor.
 *
 * The kill switch is controlled by the `CHIRO_DISABLE_METADATA=1` environment
 * variable. The version string flows into `WA|chiro|Version` (GUANO) and
 * `Software` (wamd).
 */
export type MetadataConfig = {
  enabled: boolean;
  chiroVersion: string;
};

export type ProcessedFile = {
  sourceFile: string;
  chunkCount: number;
  outputSampleRate: number;
  channels: number;
};

export type ProcessError = { file: string; reason: string };

export type ProcessOutcome = {
  processed: ProcessedFile[];
  errored: ProcessError[];
  skippedTooLarge: string[];
  skippedAlreadyChunked: string[];
  interrupted: boolean;
  durationMs: number;
};

export type RenameOperation = { from: string; to: string };

export type RenamePlan = {
  operations: RenameOperation[];
  skippedAlreadyPrefixed: string[];
  skippedCollision: string[];
};

export type RenameError = { file: string; reason: string };

export type RenameOutcome = {
  renamed: string[];
  skippedAlreadyPrefixed: string[];
  skippedCollision: string[];
  errored: RenameError[];
  interrupted: boolean;
  durationMs: number;
};

/**
 * Aggregated counts and errors for a completed rename session.
 * Field names use snake_case because they are serialized as JSON keys
 * consumed by external tools (jq, etc.).
 */
export type SessionResult = {
  renamed: number;
  skipped_already_prefixed: number;
  skipped_collision: number;
  errored: { file: string; reason: string }[];
  interrupted: boolean;
  duration_ms: number;
};

/**
 * Aggregated counts and errors for a completed process (split + TE) session.
 * Field names use snake_case for the same JSON-interchange reason as
 * `SessionResult`.
 */
export type ProcessResultSerialized = {
  processed: {
    source_file: string;
    chunk_count: number;
    output_sample_rate: number;
    channels: number;
  }[];
  errored: { file: string; reason: string }[];
  skipped_too_large: string[];
  skipped_already_chunked: string[];
  interrupted: boolean;
  duration_ms: number;
  engine: "wavefile" | "sox";
  engine_fallback_count: number;
  /** "full" when GUANO + wamd chunks are appended, "off" via CHIRO_DISABLE_METADATA. */
  metadata: "full" | "off";
};

// Note: only nominal events are emitted. Errors and skips are observable
// on the final ProcessOutcome (`errored`, `skippedTooLarge`, `skippedAlreadyChunked`).
// Keeping the surface narrow until we have a consumer that needs them.
export type ProgressEvent =
  | {
      kind: "file-start";
      fileIndex: number;
      fileName: string;
      fileSizeBytes: number;
      totalFiles: number;
    }
  | { kind: "chunk-written"; fileIndex: number; chunkIndex: number }
  | {
      kind: "file-done";
      fileIndex: number;
      chunkCount: number;
      fileSizeBytes: number;
    };

/**
 * Serialized form of `ProcessInput` for JSONL logging. Same shape as
 * `ProcessInput` but kept distinct so any future field additions to the
 * runtime type don't silently change the wire format.
 */
export type ProcessInputSerialized = {
  mode: TimeExpansionMode;
};

/**
 * A single JSONL entry written to `~/.chiro/sessions.jsonl` after each session.
 *
 * Discriminated on `schema_version` so older readers (which only know
 * schema 1) can ignore v2+ entries safely. The `action` field is also
 * available as a secondary discriminant.
 *
 * v1 — `vigie-prefix` rename sessions. Wire format must remain byte-stable.
 * v2 — `vigie-process` split-and-expand sessions. New in this release.
 */
export type SessionEvent =
  | {
      schema_version: 1;
      ts: string; // ISO 8601 timestamp
      version: string;
      cwd: string;
      action: "vigie-prefix";
      input: FormInput;
      result: SessionResult;
    }
  | {
      schema_version: 2;
      ts: string;
      version: string;
      cwd: string;
      action: "vigie-process";
      input: ProcessInputSerialized;
      result: ProcessResultSerialized;
    };
