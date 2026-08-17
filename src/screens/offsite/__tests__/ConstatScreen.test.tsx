import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { ConstatScreen } from "../ConstatScreen.js";
import type { PickArchiveToUploadFn, RemoteStatFn } from "../ConstatScreen.js";
import type { ChosenArchive } from "../../../lib/offsite/pickArchiveToUpload.js";
import type { OffsiteSettings } from "../../../lib/offsite/settings.js";

/** Wait for React effects and Ink's pending-escape flush to settle. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const SETTINGS: OffsiteSettings = {
  remote: "scaleway",
  bucket: "chiro-manon",
  prefix: "backups",
};

const CHOSEN: ChosenArchive = {
  name: "Car340581-2026-Pass1-A1_20260814.zip",
  path: "/tmp/chiro-demo/archived/Car340581-2026-Pass1-A1_20260814.zip",
  size: 890 * 1024 * 1024,
  mtimeMs: new Date(2026, 7, 14).getTime(),
};

const makeRunningRef = (): React.RefObject<boolean> => ({ current: false });

const baseProps = {
  cwd: "/tmp/chiro-demo",
  binPath: "/usr/local/bin/rclone",
  settings: SETTINGS,
  onContinue: () => undefined,
  onBack: () => undefined,
};

describe("OffsiteConstatScreen — no backup", () => {
  it("shows the no-backup guidance and returns to the menu on Échap", async () => {
    const onBack = vi.fn();
    const pick: PickArchiveToUploadFn = () => Promise.resolve({ kind: "none" });
    const stat: RemoteStatFn = () => Promise.resolve({ kind: "absent" });

    const { stdin, lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        onBack={onBack}
        pickArchiveToUpload={pick}
        remoteStat={stat}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Aucune sauvegarde à archiver dans ce dossier.");
    expect(frame).toContain("pwd");

    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe("OffsiteConstatScreen — scan error", () => {
  it("shows the raw fs error code", async () => {
    const pick: PickArchiveToUploadFn = () =>
      Promise.resolve({ kind: "error", code: "ENOTDIR" });

    const { lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        pickArchiveToUpload={pick}
        remoteStat={() => Promise.resolve({ kind: "absent" })}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "Une erreur inattendue est survenue en lisant ce dossier.",
    );
    expect(frame).toContain("Détail technique : ENOTDIR");
  });
});

describe("OffsiteConstatScreen — ready", () => {
  it("shows the file name, size, and the standing disclaimer about the Vigie-Chiro portal", async () => {
    const onContinue = vi.fn();
    const pick: PickArchiveToUploadFn = () =>
      Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 0 });
    const stat: RemoteStatFn = () => Promise.resolve({ kind: "absent" });

    const { stdin, lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        onContinue={onContinue}
        pickArchiveToUpload={pick}
        remoteStat={stat}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes("prête à être archivée en ligne"),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain(`Fichier : ${CHOSEN.name}`);
    expect(frame).toContain("Taille  : 890 Mo");
    expect(frame).toContain(
      "Ce n'est pas le dépôt sur Vigie-Chiro : celui-ci reste à faire",
    );
    expect(frame).not.toContain("fichiers de sauvegarde");

    stdin.write("\r");
    await settle();
    expect(onContinue).toHaveBeenCalledWith(CHOSEN);
  });

  it("announces the other backups and the chosen one's date when otherCount > 0", async () => {
    const pick: PickArchiveToUploadFn = () =>
      Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 2 });

    const { lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        pickArchiveToUpload={pick}
        remoteStat={() => Promise.resolve({ kind: "absent" })}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes("prête à être archivée en ligne"),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Ce dossier contient 3 fichiers de sauvegarde");
    expect(frame).toContain("celui du 14/08");
    expect(frame).toContain("Les autres ne sont pas concernés.");
  });
});

describe("OffsiteConstatScreen — already online", () => {
  it("shows the archived date and offers only a return to the menu", async () => {
    const pick: PickArchiveToUploadFn = () =>
      Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 0 });
    const stat: RemoteStatFn = () =>
      Promise.resolve({
        kind: "present",
        bytes: CHOSEN.size,
        modTime: "2026-08-16T10:30:00+02:00",
        tier: "GLACIER",
      });

    const { lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        pickArchiveToUpload={pick}
        remoteStat={stat}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes("déjà archivée en ligne"),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Archivée le 16/08/2026");
    expect(frame).toContain("Il n'y a rien à faire.");
    expect(frame).not.toContain("Entrée");
  });
});

describe("OffsiteConstatScreen — size mismatch", () => {
  it("shows both sizes, never claims the online copy is incomplete, and confirms the local file is untouched", async () => {
    const onContinue = vi.fn();
    const pick: PickArchiveToUploadFn = () =>
      Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 0 });
    const stat: RemoteStatFn = () =>
      Promise.resolve({
        kind: "present",
        bytes: 412 * 1024 * 1024,
        modTime: "2026-08-10T10:30:00+02:00",
        tier: "GLACIER",
      });

    const { stdin, lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        onContinue={onContinue}
        pickArchiveToUpload={pick}
        remoteStat={stat}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes("Un fichier du même nom est déjà en ligne"),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Sur cet ordinateur : 890 Mo");
    expect(frame).toContain("Déjà en ligne      : 412 Mo");
    expect(frame).not.toContain("incomplet");
    expect(frame).toContain("Votre fichier ici n'est pas touché.");

    stdin.write("\r");
    await settle();
    expect(onContinue).toHaveBeenCalledWith(CHOSEN);
  });
});

describe("OffsiteConstatScreen — verify impossible (transient)", () => {
  it("offers a retry and shows the raw code", async () => {
    let calls = 0;
    const pick: PickArchiveToUploadFn = () => {
      calls++;
      return Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 0 });
    };
    const stat: RemoteStatFn = () =>
      Promise.resolve({ kind: "error", code: "rclone-exit:5" });

    const { stdin, lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={makeRunningRef()}
        pickArchiveToUpload={pick}
        remoteStat={stat}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes("Impossible de vérifier en ligne"),
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Détail technique : rclone-exit:5");
    expect(frame).toContain("réessayer");

    expect(calls).toBe(1);
    stdin.write("\r");
    await waitUntil(() => calls === 2);
  });
});

describe("OffsiteConstatScreen — réglage cassé (definitive)", () => {
  it.each(["bucket-missing", "config-error"] as const)(
    "shows the config-broken screen with no retry for %s",
    async (kind) => {
      const pick: PickArchiveToUploadFn = () =>
        Promise.resolve({ kind: "ok", chosen: CHOSEN, otherCount: 0 });
      const stat: RemoteStatFn = () => Promise.resolve({ kind });

      const { lastFrame } = render(
        <ConstatScreen
          {...baseProps}
          runningRef={makeRunningRef()}
          pickArchiveToUpload={pick}
          remoteStat={stat}
        />,
      );

      await waitUntil(() =>
        (lastFrame() ?? "").includes(
          "L'archivage en ligne n'est pas disponible",
        ),
      );

      const frame = lastFrame() ?? "";
      expect(frame).toContain(`Détail technique : ${kind}`);
      expect(frame).toContain(
        "Ce réglage se fait sur l'ordinateur, pas dans chiro.",
      );
      expect(frame).toContain("installé chiro.");
      expect(frame).not.toContain("réessayer");
    },
  );
});

describe("OffsiteConstatScreen — Ctrl+C during loading", () => {
  it("returns to the menu instead of quitting, and marks runningRef true while loading", async () => {
    const onBack = vi.fn();
    let resolvePick: (() => void) | undefined;
    const pick: PickArchiveToUploadFn = () =>
      new Promise((resolve) => {
        resolvePick = () => {
          resolve({ kind: "none" });
        };
      });
    const runningRef = makeRunningRef();

    const { stdin, lastFrame } = render(
      <ConstatScreen
        {...baseProps}
        runningRef={runningRef}
        onBack={onBack}
        pickArchiveToUpload={pick}
        remoteStat={() => Promise.resolve({ kind: "absent" })}
      />,
    );

    await settle();
    expect(lastFrame() ?? "").toContain("Analyse du dossier…");
    expect(runningRef.current).toBe(true);

    stdin.write("\x03"); // Ctrl+C
    await settle();

    expect(onBack).toHaveBeenCalledOnce();

    // Resolve the still-pending promise afterwards, purely so it doesn't
    // linger unresolved past the test.
    resolvePick?.();
  });
});
