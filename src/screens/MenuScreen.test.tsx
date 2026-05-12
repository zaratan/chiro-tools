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
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("chiro — outils Vigie-Chiro");
    expect(frame).toContain("Préfixer des enregistrements pour Vigie-Chiro");
    expect(frame).toContain("Vérifier les mises à jour");
    expect(frame).toContain("Quitter");
    expect(frame).toContain("↑↓ choisir");
    expect(frame).toContain("Entrée valider");
    expect(frame).toContain("Échap quitter");
  });

  it("focuses the first item by default (vigie-prefix)", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
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
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("triggers onPickUpdate when Enter is pressed on the second item", async () => {
    const onPickUpdate = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickUpdate={onPickUpdate}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // Down arrow → focus "update"
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
        onPickUpdate={noop}
        onQuit={onQuit}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("moves focus down twice and selects Quitter with Enter", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
        onPickUpdate={noop}
        onQuit={onQuit}
        availableVersion={null}
      />,
    );
    stdin.write("\x1b[B"); // Down arrow → focus "update"
    await settle();
    stdin.write("\x1b[B"); // Down arrow → focus "quit"
    await settle();
    stdin.write("\r");
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("shows the yellow update hint when availableVersion is non-null", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={noop}
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
        onPickUpdate={noop}
        onQuit={noop}
        availableVersion={null}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("Une mise à jour est disponible");
  });
});
