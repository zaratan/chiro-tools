import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { FormInput, RenameOutcome } from "../../../types.js";
import { ResultScreen } from "../ResultScreen.js";

const input: FormInput = {
  squareCode: "040962",
  year: 2026,
  passNumber: 3,
  pointCode: "A1",
};

const outcome = (overrides: Partial<RenameOutcome>): RenameOutcome => ({
  renamed: [],
  whitespaceFixed: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
  errored: [],
  interrupted: false,
  durationMs: 1,
  ...overrides,
});

const renderLines = (o: RenameOutcome): string[] => {
  const { lastFrame, unmount } = render(
    <ResultScreen input={input} outcome={o} onBackToMenu={() => undefined} />,
  );
  const frame = lastFrame() ?? "";
  unmount();
  return frame.split("\n").map((line) => line.replaceAll("│", "").trim());
};

const renderProse = (o: RenameOutcome): string =>
  renderLines(o)
    .filter((line) => line !== "")
    .join(" ");

describe("ResultScreen (vigie-chiro)", () => {
  it("keeps the next-step sentence on a clean success", () => {
    const prose = renderProse(outcome({ renamed: ["a.wav", "b.wav"] }));

    expect(prose).toContain("✓ Terminé !");
    expect(prose).toContain(
      "Vous pouvez maintenant les découper, puis créer les fichiers zip à déposer sur Vigie-Chiro.",
    );
    expect(prose).not.toContain("pas été renommé");
  });

  it("does not say everything is already in format when raw copies collide with prefixed files", () => {
    const prose = renderProse(
      outcome({
        skippedAlreadyPrefixed: ["Car-a.wav", "Car-b.wav", "Car-c.wav"],
        skippedCollision: ["a.wav", "b.wav", "c.wav"],
      }),
    );

    expect(prose).not.toContain("Rien à faire");
    expect(prose).toContain("⚠ Aucun fichier n'a été renommé.");
    expect(prose).toContain(
      "3 fichiers laissés tels quels (déjà au bon format)",
    );
    expect(prose).toContain(
      "⚠ 3 fichiers n'ont pas été renommés (un fichier porte déjà le nom cible) : a.wav b.wav c.wav",
    );
    expect(prose).toContain(
      "Vérifiez ces fichiers avant de découper : tels quels, ils seraient découpés avec les autres.",
    );
    expect(prose).not.toContain("Vous pouvez maintenant");
  });

  it("does not announce a finished rename of zero files when the only file collides", () => {
    const prose = renderProse(outcome({ skippedCollision: ["a.wav"] }));

    expect(prose).not.toContain("Terminé");
    expect(prose).not.toContain("0 fichier renommé");
    expect(prose).not.toContain("laissé");
    expect(prose).toContain("⚠ Aucun fichier n'a été renommé.");
    expect(prose).toContain("⚠ 1 fichier n'a pas été renommé");
    expect(prose).toContain(
      "Vérifiez ce fichier avant de découper : tel quel, il serait découpé avec les autres.",
    );
  });

  it("lists the collisions next to a success instead of finishing without reserve", () => {
    const prose = renderProse(
      outcome({ renamed: ["a.wav"], skippedCollision: ["b.wav"] }),
    );

    expect(prose).toContain("✓ Terminé !");
    expect(prose).toContain("1 fichier renommé avec le préfixe");
    expect(prose).toContain(
      "⚠ 1 fichier n'a pas été renommé (un fichier porte déjà le nom cible) : b.wav",
    );
    expect(prose).not.toContain("Vous pouvez maintenant");
  });

  it("truncates the collision names like the error groups so the summary stays on screen", () => {
    const prose = renderProse(
      outcome({
        renamed: ["z.wav"],
        skippedCollision: ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav"],
      }),
    );

    expect(prose).toContain("a.wav b.wav c.wav ... et 2 autres");
    expect(prose).not.toContain("d.wav");
  });

  it("shows the errors met before an interruption instead of only the renamed count", () => {
    const prose = renderProse(
      outcome({
        renamed: ["a.wav"],
        errored: [{ file: "b.wav", reason: "EACCES" }],
        skippedCollision: ["c.wav"],
        interrupted: true,
      }),
    );

    expect(prose).toContain("ℹ Renommage arrêté à votre demande");
    expect(prose).toContain("1 fichier déjà renommé (conservé en sécurité)");
    expect(prose).toContain(
      "1 fichier n'a pas pu être renommé : • permission refusée par le système (1 fichier) b.wav",
    );
    expect(prose).toContain("⚠ 1 fichier n'a pas été renommé");
    expect(prose).toContain("c.wav");
    expect(prose.indexOf("n'a pas pu être renommé")).toBeLessThan(
      prose.indexOf("n'a pas été renommé"),
    );
  });

  it("keeps the plain interruption screen when nothing went wrong before the stop", () => {
    const prose = renderProse(
      outcome({ renamed: ["a.wav", "b.wav"], interrupted: true }),
    );

    expect(prose).toContain("2 fichiers déjà renommés (conservés en sécurité)");
    expect(prose).not.toContain("n'a pas pu être renommé");
    expect(prose).not.toContain("n'ont pas pu être renommés");
    expect(prose).not.toContain("n'a pas été renommé");
  });

  it("lists the collisions alongside partial errors, apart from the rename-time EEXIST", () => {
    const prose = renderProse(
      outcome({
        renamed: ["a.wav"],
        errored: [{ file: "b.wav", reason: "EEXIST" }],
        skippedCollision: ["c.wav"],
      }),
    );

    expect(prose).toContain("⚠ Renommage terminé avec 1 souci");
    expect(prose).toContain(
      "• un fichier portant le nom cible existe déjà — non remplacé (1 fichier) b.wav",
    );
    expect(prose).toContain(
      "⚠ 1 fichier n'a pas été renommé (un fichier porte déjà le nom cible) : c.wav",
    );
    expect(prose).toContain("Les autres fichiers ont bien été renommés.");
    expect(prose.indexOf("n'a pas pu être renommé")).toBeLessThan(
      prose.indexOf("n'a pas été renommé"),
    );
  });

  it("leaves a single blank line after the error groups so the next block stays close", () => {
    const lines = renderLines(
      outcome({
        renamed: ["a.wav"],
        errored: [
          { file: "b.wav", reason: "EACCES" },
          { file: "c.wav", reason: "ENOENT" },
        ],
        skippedCollision: ["d.wav"],
      }),
    );

    expect(lines.join("\n")).not.toContain("\n\n\n");
  });

  it("does not claim the other files were renamed when partial errors left nothing renamed", () => {
    const prose = renderProse(
      outcome({
        errored: [{ file: "a.wav", reason: "EACCES" }],
        skippedCollision: ["b.wav"],
      }),
    );

    expect(prose).toContain("⚠ Renommage terminé avec 1 souci");
    expect(prose).toContain("Aucun fichier renommé");
    expect(prose).not.toContain("0 fichier renommé");
    expect(prose).not.toContain("Les autres fichiers ont bien été renommés.");
    expect(prose).toContain(
      "permission refusée par le système (1 fichier) a.wav",
    );
  });

  it("reports space fixes on their own line, without a zero prefixed count", () => {
    const prose = renderProse(
      outcome({ whitespaceFixed: ["Car1-a b.wav", "Car1-c d.wav"] }),
    );

    expect(prose).toContain("✓ Terminé !");
    expect(prose).not.toContain("avec le préfixe");
    expect(prose).toContain(
      "2 fichiers déjà préfixés : espaces remplacés par « _ »",
    );
    expect(prose).toContain("Vous pouvez maintenant les découper");
  });

  it("keeps the prefix count to the files that got the prefix when spaces were fixed too", () => {
    const prose = renderProse(
      outcome({ renamed: ["a.wav"], whitespaceFixed: ["Car1-b c.wav"] }),
    );

    expect(prose).toContain("1 fichier renommé avec le préfixe");
    expect(prose).toContain(
      "1 fichier déjà préfixé : espaces remplacés par « _ »",
    );
  });

  it("does not say nothing was renamed on partial errors when spaces were fixed", () => {
    const prose = renderProse(
      outcome({
        whitespaceFixed: ["Car1-a b.wav"],
        errored: [{ file: "Car1-c d.wav", reason: "EACCES" }],
      }),
    );

    expect(prose).not.toContain("Aucun fichier renommé");
    expect(prose).toContain(
      "1 fichier déjà préfixé : espaces remplacés par « _ »",
    );
    expect(prose).toContain("Les autres fichiers ont bien été renommés.");
  });

  it("asks to remove a colliding file with a space, since the split would refuse to start", () => {
    const prose = renderProse(
      outcome({
        whitespaceFixed: ["Car1-PR01 a.wav"],
        skippedCollision: ["PR01 a.wav"],
      }),
    );

    expect(prose).toContain(
      "Retirez ce fichier du dossier avant de découper : son nom contient un espace : le découpage ne démarrerait pas.",
    );
    expect(prose).not.toContain("Vérifiez");
  });

  it("counts the space fixes among the files already renamed before an interruption", () => {
    const prose = renderProse(
      outcome({
        renamed: ["a.wav"],
        whitespaceFixed: ["Car1-b c.wav"],
        interrupted: true,
      }),
    );

    expect(prose).toContain("2 fichiers déjà renommés (conservés en sécurité)");
  });
});
