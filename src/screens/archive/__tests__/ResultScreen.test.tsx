import { render } from "ink-testing-library";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../../format/bytes.js";
import { ResultScreen, type BackupRunOutcome } from "../ResultScreen.js";

/** Wait for Ink's key-flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

type OkOutcome = Extract<BackupRunOutcome, { kind: "backup-ok" }>;

describe("ArchiveResultScreen — success", () => {
  const buildOkOutcome = (entryCount: number): OkOutcome => ({
    kind: "backup-ok",
    zipPath: "/tmp/chiro-demo/archived/processed_20260101.zip",
    zipBytes: 12345,
    entryCount,
    durationMs: 4200,
    durable: true,
  });

  it("shows the plural count, the relative zip path, the size, and the backup-copy hand-off wording", () => {
    const outcome = buildOkOutcome(3);
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("3 enregistrements rassemblés dans un fichier zip");
    expect(frame).toContain(`./archived/${path.basename(outcome.zipPath)}`);
    expect(frame).toContain(formatBytes(outcome.zipBytes));
    expect(frame).toContain(
      "Ce fichier est votre copie de sauvegarde : gardez-le de côté.",
    );
    expect(frame).toContain(
      "« Créer les zips à déposer sur Vigie-Chiro » dans le menu.",
    );
    // The old, now-false claim must be gone.
    expect(frame).not.toContain(
      "Vous pouvez maintenant déposer ce fichier sur Vigie-Chiro.",
    );
  });

  it("uses the singular form for a single entry", () => {
    const outcome = buildOkOutcome(1);
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 enregistrement rassemblé dans un fichier zip");
    // Scoped to the count line specifically — the reassurance line below it
    // ("Vos enregistrements sont toujours dans...") legitimately contains
    // the plural word regardless of count.
    expect(frame).not.toContain("enregistrements rassemblés");
    expect(frame).not.toContain("1 enregistrements");
  });

  it("calls onBackToMenu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={onBackToMenu}
      />,
    );

    stdin.write("\r");
    await settle();

    expect(onBackToMenu).toHaveBeenCalledOnce();
  });
});

describe("ArchiveResultScreen — aborted", () => {
  const abortedOutcome: BackupRunOutcome = { kind: "aborted" };

  it("shows the cancellation message and confirms no zip was created", () => {
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={abortedOutcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("arrêtée à votre demande");
    expect(frame).toContain("Aucun fichier zip n'a été créé.");
  });

  it("calls onBackToMenu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={abortedOutcome}
        onBackToMenu={onBackToMenu}
      />,
    );

    stdin.write("\r");
    await settle();

    expect(onBackToMenu).toHaveBeenCalledOnce();
  });
});
