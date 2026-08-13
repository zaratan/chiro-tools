import type { ProcessInput, SessionEvent } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import type { ProcessResult } from "../audio/processWavFiles.js";

/**
 * Builds the v2 (`vigie-process`) session log entry for a completed split
 * run, ready to hand to `logSession`.
 */
export const buildVigieProcessSessionEvent = (
  input: ProcessInput,
  outcome: ProcessResult,
  cwd: string,
): SessionEvent => ({
  schema_version: 2,
  ts: new Date().toISOString(),
  version: CHIRO_VERSION,
  cwd,
  action: "vigie-process",
  input: { mode: input.mode },
  result: {
    processed: outcome.processed.map((p) => ({
      source_file: p.sourceFile,
      chunk_count: p.chunkCount,
      output_sample_rate: p.outputSampleRate,
      channels: p.channels,
    })),
    errored: outcome.errored,
    skipped_too_large: outcome.skippedTooLarge,
    skipped_already_chunked: outcome.skippedAlreadyChunked,
    interrupted: outcome.interrupted,
    duration_ms: outcome.durationMs,
    engine: outcome.engine,
    engine_fallback_count: outcome.engine_fallback_count,
    metadata: outcome.metadata,
  },
});
