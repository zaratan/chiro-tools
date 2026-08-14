import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ProgressPanel } from "../ProgressPanel.js";

describe("ProgressPanel", () => {
  it("renders the cwd and the title", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Découpage en cours…"
        counterLines={[]}
        percent={0}
        statsLine="0 fichiers • Temps écoulé 0 s"
        reassuranceLines={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/tmp/chiro-demo");
    expect(frame).toContain("Découpage en cours…");
  });

  it("renders nothing extra when counterLines is empty", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Découpage en cours…"
        counterLines={[]}
        percent={0}
        statsLine="0 fichiers • Temps écoulé 0 s"
        reassuranceLines={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Fichier");
    expect(frame).not.toContain("Enregistrement");
  });

  it("renders a single counter line", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Découpage en cours…"
        counterLines={["  Fichier 1 sur 3  •  foo.wav"]}
        percent={10}
        statsLine="1 fichiers • Temps écoulé 1 s"
        reassuranceLines={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Fichier 1 sur 3");
    expect(frame).toContain("foo.wav");
  });

  it("renders multiple counter lines", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Création du zip en cours…"
        counterLines={["  Enregistrement 1 sur 5", "  Bloc 2 sur 10"]}
        percent={20}
        statsLine="Temps écoulé 2 s"
        reassuranceLines={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Enregistrement 1 sur 5");
    expect(frame).toContain("Bloc 2 sur 10");
  });

  it("renders the progress bar and the percent alongside the stats line", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Découpage en cours…"
        counterLines={[]}
        percent={50}
        statsLine="42 fichiers • Temps écoulé 30 s"
        reassuranceLines={[]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("50 %");
    expect(frame).toContain("█");
    expect(frame).toContain("░");
    expect(frame).toContain("42 fichiers • Temps écoulé 30 s");
  });

  it("renders every reassurance line", () => {
    const { lastFrame } = render(
      <ProgressPanel
        cwd="/tmp/chiro-demo"
        title="Découpage en cours…"
        counterLines={[]}
        percent={0}
        statsLine="0 fichiers • Temps écoulé 0 s"
        reassuranceLines={[
          "Vos fichiers d'origine ne sont pas modifiés.",
          "Dossier de sortie : ./processed",
        ]}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Vos fichiers d'origine ne sont pas modifiés.");
    expect(frame).toContain("Dossier de sortie : ./processed");
  });
});
