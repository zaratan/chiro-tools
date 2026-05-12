#!/usr/bin/env bash
set -euo pipefail

# Dev utility: reset a demo directory to a known fixture state for
# manual end-to-end testing of the TUI.
#
# Usage:
#   ./scripts/reset-demo.sh [target-dir]
#
# Default target: /tmp/chiro-demo
#
# The resulting directory mirrors the dataset of a real Vigie-Chiro
# Teensy field session: 10 raw recordings + 1 already-prefixed file +
# 1 .txt log (must be ignored) + 1 uppercase .WAV (distinct stem to
# avoid APFS case-insensitive collisions).

DEMO_DIR="${1:-/tmp/chiro-demo}"

rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

# 10 raw Teensy recordings (timestamps inspired by a real session)
for sec in 04 09 11 18 25 35 37 40 42 45; do
  touch "$DEMO_DIR/PaRecPR1925645_20260507_2100${sec}.wav"
done

# 1 file already at the Vigie-Chiro format — must end up in
# `skippedAlreadyPrefixed`.
touch "$DEMO_DIR/Car040962-2026-Pass3-A1-historical.wav"

# 1 log file that the recorder ships next to the .wavs — must be
# ignored by `scanWavFiles`.
touch "$DEMO_DIR/LogPR1925645.txt"

# 1 uppercase .WAV — must be normalized to .wav in the target name.
touch "$DEMO_DIR/OTHERSTEM_20260507.WAV"

echo "✓ Demo dataset reset in $DEMO_DIR"
echo ""
ls -la "$DEMO_DIR"
