import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    /**
     * Screen tests assert on rendered frames as plain strings. Ink colours
     * through chalk, whose level is decided from the ambient environment — so
     * a developer who exports `FORCE_COLOR` (common: it makes many CLIs keep
     * their colours through a pipe) gets ANSI escapes injected mid-string and
     * watches eight screen tests fail on `toContain`, with a diff that looks
     * like a real regression and isn't. Pinning the level here makes the suite
     * depend on the repo rather than on whoever's shell is running it.
     */
    env: { FORCE_COLOR: "0" },
    /**
     * Several suites do real CPU work — splitting real WAV files through the
     * worker pool, running the compiled self-test batch, driving the full Ink
     * app end to end. Isolated they take 1-3 s; run in parallel with the rest
     * of the suite they contend for cores and land just past the 5 s default.
     *
     * That produced a flake that moved from one test to another between runs
     * (three different ones over three consecutive passes), which is the kind
     * that gets re-run without being read. The work is genuinely slow, not
     * hung: the budget was wrong, not the tests.
     */
    testTimeout: 30_000,
    coverage: {
      include: ["src/lib/**"],
      reporter: ["text", "html"],
    },
  },
});
