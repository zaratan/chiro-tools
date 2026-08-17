import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { DuplicateNamesScreen } from "../DuplicateNamesScreen.js";

/** Wait for Ink's escape-key flush (>= 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

describe("DuplicateNamesScreen", () => {
  it("shows the warning, the count, and every name when there are 4 or fewer", () => {
    const { lastFrame } = render(
      <DuplicateNamesScreen
        names={["a.wav", "b.wav"]}
        onBack={() => undefined}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⚠ 2 enregistrements existent aux deux endroits");
    expect(frame).toContain("a.wav");
    expect(frame).toContain("b.wav");
    expect(frame).not.toContain("... et");
  });

  it("uses the singular form for a single duplicate", () => {
    const { lastFrame } = render(
      <DuplicateNamesScreen names={["a.wav"]} onBack={() => undefined} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⚠ 1 enregistrement existe aux deux endroits");
  });

  it("bounds the listed names to 4 and summarizes the rest", () => {
    const names = ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav", "f.wav"];
    const { lastFrame } = render(
      <DuplicateNamesScreen names={names} onBack={() => undefined} />,
    );
    const frame = lastFrame() ?? "";
    for (const name of ["a.wav", "b.wav", "c.wav", "d.wav"]) {
      expect(frame).toContain(name);
    }
    expect(frame).not.toContain("e.wav");
    expect(frame).not.toContain("f.wav");
    expect(frame).toContain("... et 2 autres");
  });

  it("shows only the Échap footer hint", () => {
    const { lastFrame } = render(
      <DuplicateNamesScreen names={["a.wav"]} onBack={() => undefined} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Échap retour au menu");
    expect(frame).not.toContain("Entrée");
  });

  it("calls onBack when Échap is pressed", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <DuplicateNamesScreen names={["a.wav"]} onBack={onBack} />,
    );
    stdin.write("\u001b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
