import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { FormInput } from "../../../types.js";
import { FormScreen } from "../FormScreen.js";

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const fromFiles: FormInput = {
  squareCode: "123456",
  year: 2026,
  passNumber: 1,
  pointCode: "A1",
};

const renderForm = (
  initialInput: FormInput | null,
  filesInput: FormInput | null,
) => {
  const onSubmit = vi.fn();
  const rendered = render(
    <FormScreen
      initialInput={initialInput}
      filesInput={filesInput}
      onSubmit={onSubmit}
      onBack={() => undefined}
    />,
  );
  const lines = (): string[] =>
    (rendered.lastFrame() ?? "")
      .split("\n")
      .map((line) => line.replaceAll("│", "").trim());
  const press = async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      rendered.stdin.write(key);
      await settle();
    }
  };
  return { lines, press, onSubmit };
};

describe("FormScreen (vigie-chiro) — values read from the files", () => {
  it("fills the four fields and says where the values come from in place of the square help", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    expect(form.lines().join(" ")).toContain("123456");
    expect(form.lines()).toContain(
      "Valeurs reprises des fichiers déjà préfixés.",
    );
    expect(form.lines().join(" ")).not.toContain("Le numéro à 6 chiffres");
    expect(form.lines()).toContain(
      "Reprise des fichiers déjà préfixés. Modifiable si besoin.",
    );
    expect(form.lines().join(" ")).toContain(
      "Combien de fois vous êtes déjà passée",
    );
  });

  it("submits the values of the files untouched on a single Entrée", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\r");

    expect(form.onSubmit).toHaveBeenCalledWith(fromFiles);
  });

  it("replaces the pass number on the first digit typed, so 1 becomes 2 and not 12", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\t", "\t", "2", "\r");

    expect(form.onSubmit).toHaveBeenCalledWith({ ...fromFiles, passNumber: 2 });
  });

  it("appends the digits typed after the first one", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\t", "\t", "1", "2", "\r");

    expect(form.onSubmit).toHaveBeenCalledWith({
      ...fromFiles,
      passNumber: 12,
    });
  });

  it("appends to a value already adjusted with the arrows", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\t", "\t", "\x1B[C", "5", "\r");

    expect(form.onSubmit).toHaveBeenCalledWith({
      ...fromFiles,
      passNumber: 25,
    });
  });

  it("replaces the year on the first digit too", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\t", "2", "0", "2", "5", "\r");

    expect(form.onSubmit).toHaveBeenCalledWith({ ...fromFiles, year: 2025 });
  });
});

describe("FormScreen (vigie-chiro) — without values from the files", () => {
  it("keeps the usual helps and an empty square code", async () => {
    const form = renderForm(null, null);
    await settle();

    expect(form.lines().join(" ")).toContain("Le numéro à 6 chiffres");
    expect(form.lines()).toContain(
      "Pré-remplie sur cette année. Modifiable si besoin.",
    );
    expect(form.lines().join(" ")).not.toContain("Valeurs reprises");
  });

  it("replaces the default pass number of 1 on the first digit typed", async () => {
    const form = renderForm(null, null);
    await settle();

    await form.press("123456", "\t", "\t", "2", "\t", "A1", "\r");

    expect(form.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ passNumber: 2 }),
    );
  });

  it("shows the values she typed when she comes back from the confirmation, with the usual helps", async () => {
    const typed: FormInput = { ...fromFiles, passNumber: 2 };
    const form = renderForm(typed, null);
    await settle();

    expect(form.lines().join(" ")).toContain("123456");
    expect(form.lines()).toContain("2  ✓");
    expect(form.lines().join(" ")).not.toContain("Valeurs reprises");
    await form.press("\r");
    expect(form.onSubmit).toHaveBeenCalledWith(typed);
  });
});

describe("FormScreen (vigie-chiro) — helps that stay true", () => {
  it("gives back the usual square help once she changes the square code", async () => {
    const form = renderForm(fromFiles, fromFiles);
    await settle();

    await form.press("\x7F");

    expect(form.lines().join(" ")).toContain("Le numéro à 6 chiffres");
    expect(form.lines().join(" ")).not.toContain("Valeurs reprises");
  });

  it("keeps saying where the year comes from when she comes back from the confirmation", async () => {
    const files: FormInput = { ...fromFiles, year: 2025 };
    const form = renderForm({ ...files, passNumber: 2 }, files);
    await settle();

    expect(form.lines()).toContain(
      "Reprise des fichiers déjà préfixés. Modifiable si besoin.",
    );
    expect(form.lines().join(" ")).not.toContain("Pré-remplie sur cette année");
    expect(form.lines()).toContain(
      "Valeurs reprises des fichiers déjà préfixés.",
    );
  });

  it("gives back the usual year help once the year differs from the files", async () => {
    const form = renderForm({ ...fromFiles, year: 2025 }, fromFiles);
    await settle();

    expect(form.lines()).toContain(
      "Pré-remplie sur cette année. Modifiable si besoin.",
    );
  });
});
