import { render } from "ink-testing-library";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../../lib/format/bytes.js";
import { ResultScreen } from "../ResultScreen.js";
import type { ArchiveRunOutcome } from "../useArchiveRun.js";

/** Wait for Ink's key-flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

type OkOutcome = Extract<ArchiveRunOutcome, { kind: "ok" }>;

describe("ArchiveResultScreen — success", () => {
  const buildOkOutcome = (entryCount: number): OkOutcome => ({
    kind: "ok",
    zipPath: "/tmp/chiro-demo/archived/processed_202601011230.zip",
    zipBytes: 12345,
    entryCount,
    durationMs: 4200,
  });

  it("shows the plural count, the relative zip path, the size, and the Vigie-Chiro hand-off line", () => {
    const outcome = buildOkOutcome(3);
    const { lastFrame } = render(
      <ResultScreen outcome={outcome} onBackToMenu={() => undefined} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("3 enregistrements rassemblés dans un fichier zip");
    expect(frame).toContain(`./archived/${path.basename(outcome.zipPath)}`);
    expect(frame).toContain(formatBytes(outcome.zipBytes));
    expect(frame).toContain(
      "Vous pouvez maintenant déposer ce fichier sur Vigie-Chiro.",
    );
  });

  it("uses the singular form for a single entry", () => {
    const outcome = buildOkOutcome(1);
    const { lastFrame } = render(
      <ResultScreen outcome={outcome} onBackToMenu={() => undefined} />,
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
      <ResultScreen outcome={buildOkOutcome(2)} onBackToMenu={onBackToMenu} />,
    );

    stdin.write("\r");
    await settle();

    expect(onBackToMenu).toHaveBeenCalledOnce();
  });
});

describe("ArchiveResultScreen — aborted", () => {
  const abortedOutcome: ArchiveRunOutcome = { kind: "aborted" };

  it("shows the cancellation message and confirms no zip was created", () => {
    const { lastFrame } = render(
      <ResultScreen outcome={abortedOutcome} onBackToMenu={() => undefined} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("arrêtée à votre demande");
    expect(frame).toContain("Aucun fichier zip n'a été créé.");
  });

  it("calls onBackToMenu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <ResultScreen outcome={abortedOutcome} onBackToMenu={onBackToMenu} />,
    );

    stdin.write("\r");
    await settle();

    expect(onBackToMenu).toHaveBeenCalledOnce();
  });
});
