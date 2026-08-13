import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { MenuScreen } from "./MenuScreen.js";

/** Wait for React effects and Ink's pending-escape flush to settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

const noop = () => undefined;

describe("MenuScreen", () => {
  it("renders the title, all menu items, and the footer hints", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("chiro — outils Vigie-Chiro");
    expect(frame).toContain("Préfixer des enregistrements pour Vigie-Chiro");
    expect(frame).toContain("Créer un zip des enregistrements découpés");
    expect(frame).toContain("Vérifier les mises à jour");
    expect(frame).toContain("Quitter");
    expect(frame).toContain("↑↓ choisir");
    expect(frame).toContain("Entrée valider");
    expect(frame).toContain("Échap quitter");
  });

  it("lists the archive entry right after the splitting entry", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    const frame = lastFrame() ?? "";
    const processIndex = frame.indexOf("Découper les enregistrements");
    const archiveIndex = frame.indexOf("Créer un zip");
    const updateIndex = frame.indexOf("Vérifier les mises à jour");
    expect(processIndex).toBeLessThan(archiveIndex);
    expect(archiveIndex).toBeLessThan(updateIndex);
  });

  it("focuses the first item by default (vigie-prefix)", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    const frame = lastFrame() ?? "";
    const vigieLineIndex = frame.indexOf("Préfixer des enregistrements");
    const arrowIndex = frame.indexOf("▸");
    expect(arrowIndex).toBeGreaterThan(-1);
    expect(arrowIndex).toBeLessThan(vigieLineIndex);
  });

  it("triggers onPickVigiePrefix when Enter is pressed on the first item", async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={onPick}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("triggers onPickVigieProcess when Enter is pressed on the second item", async () => {
    const onPickVigieProcess = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={onPickVigieProcess}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // Down arrow → focus "vigie-process"
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickVigieProcess).toHaveBeenCalledOnce();
  });

  it("triggers onPickArchive when Enter is pressed on the third item", async () => {
    const onPickArchive = vi.fn();
    const onPickVigieProcess = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={onPickVigieProcess}
        onPickArchive={onPickArchive}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → archive
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickArchive).toHaveBeenCalledOnce();
    expect(onPickVigieProcess).not.toHaveBeenCalled();
  });

  it("triggers onPickUpdate when Enter is pressed on the fourth item", async () => {
    const onPickUpdate = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={onPickUpdate}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → archive
    await settle();
    stdin.write("\x1b[B"); // → update
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPickUpdate).toHaveBeenCalledOnce();
  });

  it("triggers onQuit when Escape is pressed", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={onQuit}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("moves focus down four times and selects Quitter with Enter", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={onQuit}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // → vigie-process
    await settle();
    stdin.write("\x1b[B"); // → archive
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
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion="v0.2.0"
      />,
    );
    expect(lastFrame() ?? "").toContain(
      "⚠ Une mise à jour est disponible (v0.2.0).",
    );
  });

  it("does not show the update hint when availableVersion is null", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={noop}
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("Une mise à jour est disponible");
  });

  it("hides update entry and jumps from the archive entry to Quitter when autoUpdateDisabled=true", async () => {
    const onQuit = vi.fn();
    const onPickArchive = vi.fn();
    const { stdin, lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickVigieProcess={noop}
        onPickArchive={onPickArchive}
        onPickUpdate={noop}
        onQuit={onQuit}
        availableVersion={null}
        autoUpdateDisabled={true}
      />,
    );

    expect(lastFrame() ?? "").not.toContain("Vérifier les mises à jour");

    // Down three times → quit directly after the archive entry (update absent)
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\x1b[B");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
    expect(onPickArchive).not.toHaveBeenCalled();
  });
});
