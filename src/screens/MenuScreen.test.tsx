import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { MenuScreen } from "./MenuScreen.js";

/** Wait for React effects and Ink's pending-escape flush to settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

const noop = () => undefined;

const baseProps = {
  onPickVigiePrefix: noop,
  onPickVigieProcess: noop,
  onPickPackage: noop,
  onPickBackup: noop,
  onPickOffsite: noop,
  onPickUpdate: noop,
  onQuit: noop,
  availableVersion: null,
};

describe("MenuScreen", () => {
  it("renders the title, all menu items, and the footer hints", () => {
    const { lastFrame } = render(<MenuScreen {...baseProps} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("chiro — outils Vigie-Chiro");
    expect(frame).toContain("Préfixer des enregistrements pour Vigie-Chiro");
    expect(frame).toContain("Créer les zips à déposer sur Vigie-Chiro");
    expect(frame).toContain(
      "Sauvegarder les enregistrements découpés (un seul zip)",
    );
    expect(frame).toContain("Vérifier les mises à jour");
    expect(frame).toContain("Quitter");
    expect(frame).toContain("↑↓ choisir");
    expect(frame).toContain("Entrée valider");
    expect(frame).toContain("Échap quitter");
  });

  it("lists the entries in the expected order: prefix, process, package, backup, update, quit", () => {
    const { lastFrame } = render(<MenuScreen {...baseProps} />);
    const frame = lastFrame() ?? "";
    const prefixIndex = frame.indexOf("Préfixer des enregistrements");
    const processIndex = frame.indexOf("Découper les enregistrements");
    const packageIndex = frame.indexOf("Créer les zips à déposer");
    const backupIndex = frame.indexOf("Sauvegarder les enregistrements");
    const updateIndex = frame.indexOf("Vérifier les mises à jour");
    expect(prefixIndex).toBeLessThan(processIndex);
    expect(processIndex).toBeLessThan(packageIndex);
    expect(packageIndex).toBeLessThan(backupIndex);
    expect(backupIndex).toBeLessThan(updateIndex);
  });

  it("focuses the first item by default (vigie-prefix)", () => {
    const { lastFrame } = render(<MenuScreen {...baseProps} />);
    const frame = lastFrame() ?? "";
    const vigieLineIndex = frame.indexOf("Préfixer des enregistrements");
    const arrowIndex = frame.indexOf("▸");
    expect(arrowIndex).toBeGreaterThan(-1);
    expect(arrowIndex).toBeLessThan(vigieLineIndex);
  });

  it("triggers onPickVigiePrefix when Enter is pressed on the first item", async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <MenuScreen {...baseProps} onPickVigiePrefix={onPick} />,
    );
    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("triggers onPickVigieProcess when Enter is pressed on the second item", async () => {
    const onPickVigieProcess = vi.fn();
    const { stdin } = render(
      <MenuScreen {...baseProps} onPickVigieProcess={onPickVigieProcess} />,
    );
    stdin.write("\x1b[B"); // Down arrow → focus "vigie-process"
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickVigieProcess).toHaveBeenCalledOnce();
  });

  it("triggers onPickPackage when Enter is pressed on the third item", async () => {
    const onPickPackage = vi.fn();
    const onPickVigieProcess = vi.fn();
    const { stdin } = render(
      <MenuScreen
        {...baseProps}
        onPickVigieProcess={onPickVigieProcess}
        onPickPackage={onPickPackage}
      />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → package
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickPackage).toHaveBeenCalledOnce();
    expect(onPickVigieProcess).not.toHaveBeenCalled();
  });

  it("triggers onPickBackup when Enter is pressed on the fourth item", async () => {
    const onPickBackup = vi.fn();
    const { stdin } = render(
      <MenuScreen {...baseProps} onPickBackup={onPickBackup} />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → package
    await settle();
    stdin.write("\x1b[B"); // → backup
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickBackup).toHaveBeenCalledOnce();
  });

  it("triggers onPickUpdate when Enter is pressed on the fifth item", async () => {
    const onPickUpdate = vi.fn();
    const { stdin } = render(
      <MenuScreen {...baseProps} onPickUpdate={onPickUpdate} />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → package
    await settle();
    stdin.write("\x1b[B"); // → backup
    await settle();
    stdin.write("\x1b[B"); // → update
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickUpdate).toHaveBeenCalledOnce();
  });

  it("triggers onQuit when Escape is pressed", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(<MenuScreen {...baseProps} onQuit={onQuit} />);
    stdin.write("\x1b");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("moves focus down five times and selects Quitter with Enter", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(<MenuScreen {...baseProps} onQuit={onQuit} />);
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → package
    await settle();
    stdin.write("\x1b[B"); // → backup
    await settle();
    stdin.write("\x1b[B"); // → update
    await settle();
    stdin.write("\x1b[B"); // → quit
    await settle();
    stdin.write("\r");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("shows the yellow update hint when availableVersion is non-null", () => {
    const { lastFrame } = render(
      <MenuScreen {...baseProps} availableVersion="v0.2.0" />,
    );
    expect(lastFrame() ?? "").toContain(
      "⚠ Une mise à jour est disponible (v0.2.0).",
    );
  });

  it("does not show the update hint when availableVersion is null", () => {
    const { lastFrame } = render(<MenuScreen {...baseProps} />);
    expect(lastFrame() ?? "").not.toContain("Une mise à jour est disponible");
  });

  it("hides update entry and jumps from the backup entry to Quitter when autoUpdateDisabled=true", async () => {
    const onQuit = vi.fn();
    const onPickBackup = vi.fn();
    const { stdin, lastFrame } = render(
      <MenuScreen
        {...baseProps}
        onPickBackup={onPickBackup}
        onQuit={onQuit}
        autoUpdateDisabled={true}
      />,
    );

    expect(lastFrame() ?? "").not.toContain("Vérifier les mises à jour");

    // Down four times → quit directly after the backup entry (update absent)
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onPickBackup).not.toHaveBeenCalled();
  });

  it("hides the offsite entry by default", () => {
    const { lastFrame } = render(<MenuScreen {...baseProps} />);
    expect(lastFrame() ?? "").not.toContain("Archiver la sauvegarde en ligne");
  });

  it("shows the offsite entry, between backup and update, when offsiteAvailable=true", () => {
    const { lastFrame } = render(
      <MenuScreen {...baseProps} offsiteAvailable={true} />,
    );
    const frame = lastFrame() ?? "";
    const backupIndex = frame.indexOf("Sauvegarder les enregistrements");
    const offsiteIndex = frame.indexOf("Archiver la sauvegarde en ligne");
    const updateIndex = frame.indexOf("Vérifier les mises à jour");
    expect(offsiteIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeLessThan(offsiteIndex);
    expect(offsiteIndex).toBeLessThan(updateIndex);
  });

  it("triggers onPickOffsite when Enter is pressed on the offsite entry", async () => {
    const onPickOffsite = vi.fn();
    const { stdin } = render(
      <MenuScreen
        {...baseProps}
        offsiteAvailable={true}
        onPickOffsite={onPickOffsite}
      />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → package
    await settle();
    stdin.write("\x1b[B"); // → backup
    await settle();
    stdin.write("\x1b[B"); // → offsite
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickOffsite).toHaveBeenCalledOnce();
  });
});
