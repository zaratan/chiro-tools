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
  // A realistic backup zip (the project's documented range is 10-20 GB): the
  // announced duration is derived from this size, so a token value would make
  // the assertion below meaningless.
  const buildOkOutcome = (entryCount: number): OkOutcome => ({
    kind: "backup-ok",
    zipPath: "/tmp/chiro-demo/archived/processed_20260101.zip",
    zipBytes: 15 * 1024 * 1024 * 1024,
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

describe("ArchiveResultScreen — offsite proposal", () => {
  // A realistic backup zip (the project's documented range is 10-20 GB): the
  // announced duration is derived from this size, so a token value would make
  // the assertion below meaningless.
  const buildOkOutcome = (entryCount: number): OkOutcome => ({
    kind: "backup-ok",
    zipPath: "/tmp/chiro-demo/archived/processed_20260101.zip",
    zipBytes: 15 * 1024 * 1024 * 1024,
    entryCount,
    durationMs: 4200,
    durable: true,
  });

  it("renders exactly today's wording when offsiteAvailable is false", () => {
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={() => undefined}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("ℹ Pour déposer sur Vigie-Chiro, choisissez");
    expect(frame).not.toContain("Et maintenant :");
    expect(frame).not.toContain("archiver en ligne");
  });

  it("shows the two-bullet 'Et maintenant' block and the A hint when offsiteAvailable is true", () => {
    const { lastFrame } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={() => undefined}
        offsiteAvailable={true}
        onArchiveOffsite={() => undefined}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("ℹ Et maintenant :");
    expect(frame).toContain("pour déposer sur Vigie-Chiro");
    expect(frame).toContain("appuyez sur A (comptez environ 1 h 12)");
    expect(frame).toContain("A archiver en ligne");
    expect(frame).toContain("Entrée retour au menu");
  });

  it("triggers onArchiveOffsite on lowercase 'a'", async () => {
    const onArchiveOffsite = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={() => undefined}
        offsiteAvailable={true}
        onArchiveOffsite={onArchiveOffsite}
      />,
    );
    stdin.write("a");
    await settle();
    expect(onArchiveOffsite).toHaveBeenCalledOnce();
  });

  it("triggers onArchiveOffsite on uppercase 'A'", async () => {
    const onArchiveOffsite = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={() => undefined}
        offsiteAvailable={true}
        onArchiveOffsite={onArchiveOffsite}
      />,
    );
    stdin.write("A");
    await settle();
    expect(onArchiveOffsite).toHaveBeenCalledOnce();
  });

  it("Entrée still returns to the menu, never archives, even when offsiteAvailable", async () => {
    const onBackToMenu = vi.fn();
    const onArchiveOffsite = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={onBackToMenu}
        offsiteAvailable={true}
        onArchiveOffsite={onArchiveOffsite}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onBackToMenu).toHaveBeenCalledOnce();
    expect(onArchiveOffsite).not.toHaveBeenCalled();
  });

  it("does not trigger onArchiveOffsite on 'a' when offsiteAvailable is false", async () => {
    const onArchiveOffsite = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={buildOkOutcome(2)}
        onBackToMenu={() => undefined}
        onArchiveOffsite={onArchiveOffsite}
      />,
    );
    stdin.write("a");
    await settle();
    expect(onArchiveOffsite).not.toHaveBeenCalled();
  });

  it("does not trigger onArchiveOffsite on 'a' for the aborted outcome, even when offsiteAvailable", async () => {
    const onArchiveOffsite = vi.fn();
    const { stdin } = render(
      <ResultScreen
        cwd="/tmp/chiro-demo"
        outcome={{ kind: "aborted" }}
        onBackToMenu={() => undefined}
        offsiteAvailable={true}
        onArchiveOffsite={onArchiveOffsite}
      />,
    );
    stdin.write("a");
    await settle();
    expect(onArchiveOffsite).not.toHaveBeenCalled();
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
