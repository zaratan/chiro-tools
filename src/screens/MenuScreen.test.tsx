import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { MenuScreen } from "./MenuScreen.js";

/** Wait for React effects and Ink's pending-escape flush to settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("MenuScreen", () => {
  it("renders the title, both menu items, and the footer hints", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={() => undefined}
        onQuit={() => undefined}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("chiro — outils Vigie-Chiro");
    expect(frame).toContain("Préfixer des enregistrements pour Vigie-Chiro");
    expect(frame).toContain("Quitter");
    expect(frame).toContain("↑↓ choisir");
    expect(frame).toContain("Entrée valider");
    expect(frame).toContain("Échap quitter");
  });

  it("focuses the first item by default (vigie-prefix)", () => {
    const { lastFrame } = render(
      <MenuScreen
        onPickVigiePrefix={() => undefined}
        onQuit={() => undefined}
      />,
    );
    const frame = lastFrame() ?? "";
    // The focused item shows the ▸ marker before its label.
    const vigieLineIndex = frame.indexOf("Préfixer des enregistrements");
    const arrowIndex = frame.indexOf("▸");
    expect(arrowIndex).toBeGreaterThan(-1);
    expect(arrowIndex).toBeLessThan(vigieLineIndex);
  });

  it("triggers onPickVigiePrefix when Enter is pressed on the first item", async () => {
    const onPick = vi.fn();
    const { stdin } = render(
      <MenuScreen onPickVigiePrefix={onPick} onQuit={() => undefined} />,
    );
    stdin.write("\r"); // Enter
    await settle();
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("triggers onQuit when Escape is pressed", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <MenuScreen onPickVigiePrefix={() => undefined} onQuit={onQuit} />,
    );
    stdin.write("\x1b"); // Escape
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });

  it("moves focus down with arrow key and selects Quitter with Enter", async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <MenuScreen onPickVigiePrefix={() => undefined} onQuit={onQuit} />,
    );
    stdin.write("\x1b[B"); // Down arrow
    await settle();
    stdin.write("\r"); // Enter
    await settle();
    expect(onQuit).toHaveBeenCalledOnce();
  });
});
