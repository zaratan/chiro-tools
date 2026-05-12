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
 * A single JSONL entry written to `~/.chiro/sessions.jsonl` after each session.
 * Field names use snake_case for JSON interchange compatibility.
 */
export type SessionEvent = {
  schema_version: 1;
  ts: string; // ISO 8601 timestamp
  version: string;
  cwd: string;
  action: Action;
  input: FormInput;
  result: SessionResult;
};
