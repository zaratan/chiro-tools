import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../../format/bytes.js";
import { ResultScreen, type OffsiteResultOutcome } from "../ResultScreen.js";

/** Wait for Ink's key-flush. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const okOutcome: Extract<OffsiteResultOutcome, { kind: "ok" }> = {
  kind: "ok",
  zipName: "Car340581-2026-Pass1-A1_20260814.zip",
  zipBytes: 15 * 1024 * 1024 * 1024,
  verified: "size-match",
  finishedAtMs: new Date(2026, 7, 15, 2, 47).getTime(),
  durationMs: (5 * 3600 + 12 * 60) * 1000,
};

describe("OffsiteResultScreen — success, verified", () => {
  it("shows the finish time AND the duration, in that order, with the ✓", () => {
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={okOutcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓ Terminé !");
    expect(frame).toContain(okOutcome.zipName);
    expect(frame).toContain(formatBytes(okOutcome.zipBytes));
    expect(frame).toContain("Terminé à 2 h 47, après 5 h 12");
    expect(frame).toContain(
      "chiro a vérifié que le fichier est bien arrivé, en entier.",
    );
    expect(frame).toContain("deux copies valent mieux qu'une.");
    // The ADR-mandated exclusion: never suggest deleting the local copy.
    expect(frame).not.toContain("supprim");
  });

  it("returns to the menu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={okOutcome}
        onBackToMenu={onBackToMenu}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onBackToMenu).toHaveBeenCalledTimes(1);
  });
});

describe("OffsiteResultScreen — success, unverified", () => {
  it("still shows the green ✓, with a different, non-alarming verification sentence", () => {
    const outcome: OffsiteResultOutcome = {
      ...okOutcome,
      verified: "unavailable",
    };
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓ Terminé !");
    expect(frame).toContain("L'envoi s'est terminé normalement.");
    expect(frame).not.toContain(
      "chiro a vérifié que le fichier est bien arrivé, en entier.",
    );
    expect(frame).not.toContain("⚠");
  });
});

describe("OffsiteResultScreen — interrupted", () => {
  it("shows the ℹ interruption screen and returns to the menu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { lastFrame, stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{ kind: "aborted" }}
        onBackToMenu={onBackToMenu}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("ℹ Archivage en ligne arrêté à votre demande");
    expect(frame).toContain("Le fichier n'a pas été archivé.");
    expect(frame).toContain("./archived/");
    // Must not invent a "nothing partial stayed online" reassurance the
    // brief explicitly rejects.
    expect(frame).not.toContain("resté en ligne");

    stdin.write("\r");
    await settle();
    expect(onBackToMenu).toHaveBeenCalledTimes(1);
  });
});

describe("OffsiteResultScreen — run-error", () => {
  it("transient: offers Entrée réessayer AND the 'reprend depuis le début' line with a duration", async () => {
    const onRetry = vi.fn();
    const { lastFrame, stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{
          kind: "run-error",
          code: "transient",
          zipBytes: 15 * 1024 * 1024 * 1024,
        }}
        onBackToMenu={() => undefined}
        onRetry={onRetry}
        onBackToStart={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "⚠ Une erreur est survenue pendant l'archivage en ligne.",
    );
    expect(frame).toContain("Le fichier n'a pas été archivé");
    expect(frame).toContain("./archived/");
    expect(frame).toContain("Détail technique : transient");
    expect(frame).toContain("l'archivage reprend depuis le début");
    expect(frame).toContain("Entrée réessayer");

    stdin.write("\r");
    await settle();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("definitive: offers neither Entrée réessayer nor the restart-duration line", () => {
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{
          kind: "run-error",
          code: "fatal",
          zipBytes: 15 * 1024 * 1024 * 1024,
        }}
        onBackToMenu={() => undefined}
        onRetry={() => undefined}
        onBackToStart={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Entrée réessayer");
    expect(frame).not.toContain("reprend depuis le début");
    expect(frame).toContain("Échap");
  });

  it("Échap returns to the start on either transient or definitive codes", async () => {
    const onBackToStart = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{ kind: "run-error", code: "fatal", zipBytes: 4 }}
        onBackToMenu={() => undefined}
        onRetry={() => undefined}
        onBackToStart={onBackToStart}
      />,
    );
    stdin.write("\u001b"); // Échap
    await settle();
    expect(onBackToStart).toHaveBeenCalledTimes(1);
  });

  it("Entrée does nothing on a definitive code (no retry offered)", async () => {
    const onRetry = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{ kind: "run-error", code: "fatal", zipBytes: 4 }}
        onBackToMenu={() => undefined}
        onRetry={onRetry}
        onBackToStart={() => undefined}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
