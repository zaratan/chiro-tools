# Real rclone `--use-json-log --stats` traces

Captured on 2026-08-17 with **rclone v1.75.0** (darwin/arm64) during Phase 10.0,
against the real Scaleway bucket. These are byte-for-byte stderr captures, not
hand-written samples.

They exist because a hand-written fake is authored from the same mental model as
the parser it feeds, so both can be wrong together — which is exactly what
happened when the Phase 10 plan encoded a progress contract measured only on the
happy path. Replay these instead.

| File | What it captures |
| --- | --- |
| `upload-1gb-nominal.jsonl` | 1 GiB → Scaleway GLACIER, 75 s, 75 ticks. The nominal path. |
| `copy-with-retry.jsonl` | A transfer that fails mid-flight and retries (`ulimit -f` on a local copy). The pathological path. |
| `upload-12mb-short.jsonl` | A transfer short enough to finish inside one stats interval. |

## The invariants they pin

Measured, not assumed. Every one of these breaks a naive reading of the stats:

- **`totalBytes` is not the object size, and it moves.** In `copy-with-retry` it
  goes 240 447 488 → 271 179 776 → 92 196 864 for a 209 715 200-byte file — it
  never once equals the real size. It is "bytes already accounted + remainder of
  the current transfer", a moving denominator.
- **`totalBytes` is `0` on the first two ticks** of `upload-1gb-nominal`. Dividing
  by it is a crash or an `Infinity`, on the nominal path.
- **`bytes` accumulates re-sent bytes across retries.** In `copy-with-retry` it
  reaches 92 MB for a file that never got past ~22 MB of real progress. On the
  final tick `bytes / totalBytes` is exactly **1.0 — on a transfer that failed**
  (`errors: 1`). A progress bar built on it reads 100 % on an error.
- **`transferring[0].size` is the true size** and is stable across retries;
  `transferring[0].bytes` is the true per-object progress.
- **`transferring` is empty on the final tick**, always. It cannot be the only
  source.
- **`eta` is `null` on the first three ticks** of the nominal capture, and
  `speed` is `0`. It is not reliably populated from tick one.

Hence the rule in `lib/offsite/`: the denominator is the **local file size**,
which chiro already knows; the numerator is
`transferring[0]?.bytes ?? stats.bytes`, clamped monotone; `totalBytes` and `eta`
from rclone are ignored entirely.

## Regenerating

```bash
rclone copyto <file> <remote>:<bucket>/<key> \
  --s3-storage-class GLACIER --s3-chunk-size 64Mi --s3-upload-concurrency 8 \
  --use-json-log --stats 1s --stats-log-level NOTICE --retries 1 \
  2> upload-1gb-nominal.jsonl

# the retry capture, which needs a transfer that fails partway through:
( ulimit -f 60000; rclone copyto <200MB file> <dst> --local-no-clone \
    --use-json-log --stats 1s --stats-log-level NOTICE --retries 3 --bwlimit 40M \
    2> copy-with-retry.jsonl )
```

Re-capture after any rclone major bump, and diff the invariants above before
trusting the parser.
