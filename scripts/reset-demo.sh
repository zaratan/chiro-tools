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

# Generate valid synthetic WAVs (10 Teensy-like + 2 AudioMoth-like + 1
# already-prefixed + 1 uppercase). The rename flow does not read content
# but the processing flow does — valid WAVs let both flows be exercised
# end-to-end.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bun "$SCRIPT_DIR/generate-demo-fixtures.ts" "$DEMO_DIR"

# Recorder log file that ships next to the .wavs — must be ignored by
# `scanWavFiles` (.txt extension, not .wav).
touch "$DEMO_DIR/LogPR1925645.txt"

echo "✓ Demo dataset reset in $DEMO_DIR"
echo ""
ls -la "$DEMO_DIR"
