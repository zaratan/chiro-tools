import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { ConfirmScreen } from "../ConfirmScreen.js";
import type { ChosenArchive } from "../../../lib/offsite/pickArchiveToUpload.js";

/** Wait for Ink's key-flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

/** A realistic backup zip: the project's own documented range is 10-20 GB. */
const CHOSEN: ChosenArchive = {
  name: "Car340581-2026-Pass1-A1_20260814.zip",
  path: "/tmp/chiro-demo/archived/Car340581-2026-Pass1-A1_20260814.zip",
  size: 15 * 1024 * 1024 * 1024,
  mtimeMs: Date.now(),
};

const baseProps = {
  cwd: "/tmp/chiro-demo",
  chosen: CHOSEN,
  onConfirm: () => undefined,
  onBack: () => undefined,
};

describe("OffsiteConfirmScreen — nominal (AC power)", () => {
  it("shows the aligned file/size/duration block and the Ctrl+C notice, with no battery warning", () => {
    const { lastFrame } = render(
      <ConfirmScreen {...baseProps} readPowerState={() => "ac"} />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("On va archiver votre sauvegarde en ligne.");
    expect(frame).toContain(CHOSEN.name);
    expect(frame).toContain("15,0 Go");
    expect(frame).toContain("environ 1 h 12 (selon votre connexion)");
    expect(frame).toContain("Ctrl et C ensemble");
    expect(frame).toContain("laissez l'ordinateur branché sur le secteur");
    expect(frame).toContain("Destination : stockage en ligne Scaleway");
    expect(frame).not.toContain("pas branché sur le secteur");
  });

  it("never wraps the aligned Nom du fichier / Taille / Durée prévue lines", () => {
    const { lastFrame } = render(
      <ConfirmScreen {...baseProps} readPowerState={() => "ac"} />,
    );
    const lines = (lastFrame() ?? "").split("\n");
    const fileLine = lines.find((l) => l.includes(CHOSEN.name));
    const sizeLine = lines.find((l) => l.includes("15,0 Go"));
    const durationLine = lines.find((l) => l.includes("Durée prévue"));

    expect(fileLine).toBeDefined();
    expect(sizeLine).toBeDefined();
    expect(durationLine).toBeDefined();
    // Each value sits on the same physical line as its label — a wrap
    // would push it to the next line instead.
    expect(fileLine).toContain("Nom du fichier :");
    expect(sizeLine).toContain("Taille :");
    expect(durationLine).toContain("environ 1 h 12");
  });

  it("scales the announced duration with the archive's size", () => {
    // The estimate must track the file, not be a fixed string: "environ
    // 1 h 10" printed above a 3 MB zip is visibly wrong, and an estimate a
    // user can catch out once is one she stops believing. Two sizes, two
    // announcements — a hardcoded constant fails this and passes everything
    // else in this file.
    const small = render(
      <ConfirmScreen
        {...baseProps}
        chosen={{ ...CHOSEN, size: 3 * 1024 * 1024 * 1024 }}
        readPowerState={() => "ac"}
      />,
    );
    expect(small.lastFrame() ?? "").toContain("environ 14 minutes");

    const large = render(
      <ConfirmScreen
        {...baseProps}
        chosen={{ ...CHOSEN, size: 20 * 1024 * 1024 * 1024 }}
        readPowerState={() => "ac"}
      />,
    );
    expect(large.lastFrame() ?? "").toContain("environ 1 h 35");
  });

  it("calls onConfirm on Entrée and onBack on Échap", async () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const { stdin } = render(
      <ConfirmScreen
        {...baseProps}
        onConfirm={onConfirm}
        onBack={onBack}
        readPowerState={() => "ac"}
      />,
    );

    stdin.write("\r");
    await settle();
    expect(onConfirm).toHaveBeenCalledOnce();

    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("OffsiteConfirmScreen — on battery", () => {
  it("shows the battery warning and drops the redundant AC-power clause", () => {
    const { lastFrame } = render(
      <ConfirmScreen {...baseProps} readPowerState={() => "battery"} />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).toContain("n'est pas branché sur le secteur");
    expect(frame).toContain("Branchez-le d'abord.");
    // The redundant clause must be gone once the dedicated warning is shown.
    expect(frame).not.toContain("laissez l'ordinateur branché sur le secteur");
  });

  it("stays at or under the 24-line hard budget for an 80×24 terminal, borders included", () => {
    const { lastFrame } = render(
      <ConfirmScreen {...baseProps} readPowerState={() => "battery"} />,
    );
    const lineCount = (lastFrame() ?? "").split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(24);
  });
});

describe("OffsiteConfirmScreen — power state unknown", () => {
  it("shows no battery warning at all on 'unknown'", () => {
    const { lastFrame } = render(
      <ConfirmScreen {...baseProps} readPowerState={() => "unknown"} />,
    );
    const frame = lastFrame() ?? "";

    expect(frame).not.toContain("pas branché sur le secteur");
    expect(frame).toContain("laissez l'ordinateur branché sur le secteur");
  });
});
