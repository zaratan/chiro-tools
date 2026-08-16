import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../../format/bytes.js";
import {
  UploadResultScreen,
  type PackageRunOutcome,
} from "../UploadResultScreen.js";

/** Wait for Ink's key-flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

type OkOutcome = Extract<PackageRunOutcome, { kind: "package-ok" }>;

const buildOkOutcome = (
  entryCount: number,
  volumeCount: number,
): OkOutcome => ({
  kind: "package-ok",
  seriesDirPath: "/tmp/chiro-demo/upload/Car340581-2026-Pass1-A1_20260814",
  seriesDirName: "Car340581-2026-Pass1-A1_20260814",
  volumes: Array.from({ length: volumeCount }, (_, i) => ({
    fileName: `Car340581-2026-Pass1-A1_part${(i + 1).toString()}.zip`,
    zipBytes: 1000,
    entryCount: 1,
  })),
  entryCount,
  totalZipBytes: 8_800_000_000,
  durationMs: 12 * 60 * 1000,
  durable: true,
});

describe("UploadResultScreen — success, multiple volumes", () => {
  const outcome = buildOkOutcome(720, 3);

  it("shows the split-count sentence, the series folder, total size, and multi-file deposit wording", () => {
    const { lastFrame } = render(
      <UploadResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("720 enregistrements répartis dans 3 fichiers zip");
    expect(frame).toContain("./upload/Car340581-2026-Pass1-A1_20260814/");
    expect(frame).toContain(formatBytes(outcome.totalZipBytes));
    expect(frame).toContain(
      "Déposez les 3 fichiers sur Vigie-Chiro, un par un.",
    );
    expect(frame).toContain("L'ordre n'a pas d'importance.");
    expect(frame).toContain(
      "Vous pouvez aussi garder une copie complète de côté",
    );
    expect(frame).toContain("« Sauvegarder les enregistrements découpés »");
    expect(frame).toContain("📁 /tmp/chiro-demo");
    expect(frame).toContain(
      "Vos enregistrements sont toujours dans ./processed/.",
    );
    // Never lists individual volume file names — O(N) cost on a fixed-height
    // screen.
    expect(frame).not.toContain("part1.zip");
  });

  it("calls onBackToMenu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <UploadResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={onBackToMenu}
      />,
    );

    stdin.write("\r");
    await settle();

    expect(onBackToMenu).toHaveBeenCalledOnce();
  });
});

describe("UploadResultScreen — success, single volume (N=1)", () => {
  const outcome = buildOkOutcome(40, 1);

  it("uses singular wording, no 'un par un', no 'ordre n'a pas d'importance'", () => {
    const { lastFrame } = render(
      <UploadResultScreen
        cwd="/tmp/chiro-demo"
        outcome={outcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "40 enregistrements rassemblés dans un fichier zip",
    );
    expect(frame).toContain("Déposez ce fichier sur Vigie-Chiro.");
    expect(frame).not.toContain("un par un");
    expect(frame).not.toContain("L'ordre n'a pas d'importance.");
  });
});

describe("UploadResultScreen — aborted", () => {
  const abortedOutcome: PackageRunOutcome = { kind: "aborted" };

  it("shows the deposit-flavored cancellation message and confirms no zip was created", () => {
    const { lastFrame } = render(
      <UploadResultScreen
        cwd="/tmp/chiro-demo"
        outcome={abortedOutcome}
        onBackToMenu={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("ℹ Préparation du dépôt arrêtée à votre demande");
    expect(frame).toContain("Aucun fichier zip n'a été créé.");
    expect(frame).toContain("vos enregistrements sont intacts dans");
    expect(frame).toContain("./processed/");
  });

  it("calls onBackToMenu on Entrée", async () => {
    const onBackToMenu = vi.fn();
    const { stdin } = render(
      <UploadResultScreen
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
