import { render } from "ink-testing-library";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import { ConstatScreen } from "../ConstatScreen.js";

// chmod-based access-denial tests are meaningless under root (which bypasses
// permission checks) — skip them there instead of producing a false
// failure. Mirrors src/lib/fs/scanDirectory.test.ts.
const isRoot = process.getuid?.() === 0;
const itUnlessRoot = isRoot ? it.skip : it;

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`. Needed
 * because the loading → ready state depends on real `fs` I/O (readdir +
 * stat on `processed/`), whose latency on the first test in a file can
 * exceed a couple of `setImmediate` ticks.
 */
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

/** Wait for Ink's escape-key flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

let tmpDir: string;

beforeEach(async () => {
  // `/tmp` rather than `os.tmpdir()`: on macOS the latter resolves to a long
  // `/var/folders/...` path that, combined with the mkdtemp suffix, wraps
  // Ink's 70-column "📁 <cwd>" line mid-word — breaking the very assertions
  // below that check for the exact, unwrapped string.
  tmpDir = await mkdtemp(path.join("/tmp", "chiro-test-archive-constat-"));
});

afterEach(async () => {
  // Restore permissions before recursive removal — a 500 dir would
  // otherwise make its own cleanup fail.
  await chmod(tmpDir, 0o700).catch(() => undefined);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ArchiveConstatScreen — no-processed", () => {
  it("shows guidance and mentions pwd when 'processed/' does not exist", async () => {
    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(`📁 ${tmpDir}`);
    expect(frame).toContain(
      "Aucun dossier « processed » trouvé dans ce dossier.",
    );
    expect(frame).toContain("pwd");
  });
});

describe("ArchiveConstatScreen — empty-processed", () => {
  it("shows the 'no recordings' message for a truly empty 'processed/'", async () => {
    await mkdir(path.join(tmpDir, "processed"));

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(`📁 ${tmpDir}`);
    expect(frame).toContain("ne contient aucun enregistrement");
  });

  it("shows the 'no recordings' message when 'processed/' only holds .tmp and dot-entries", async () => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "a_001.wav.tmp"), "leftover");
    await writeFile(path.join(processedDir, ".DS_Store"), "");

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("ne contient aucun enregistrement");
  });
});

describe("ArchiveConstatScreen — ready", () => {
  const prefixed = (name: string): string => `Car340581-2026-Pass1-A1-${name}`;

  const writeProcessedFiles = async (
    names: readonly string[],
  ): Promise<string> => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    for (const name of names) {
      await writeFile(path.join(processedDir, name), "1234");
    }
    return processedDir;
  };

  it("shows the count, volume, and confirmation question for N files (plural), backup mode", async () => {
    await writeProcessedFiles(
      ["a_001.wav", "a_002.wav", "a_003.wav"].map(prefixed),
    );

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(`📁 ${tmpDir}`);
    expect(frame).toContain("3 enregistrements trouvés dans ./processed/");
    expect(frame).toContain("Volume total :");
    expect(frame).toContain(
      "Ce sont bien les enregistrements à mettre dans le zip ?",
    );
  });

  it("shows the upload-flavored closing question in package mode", async () => {
    await writeProcessedFiles([prefixed("a_001.wav")]);

    const { lastFrame } = render(
      <ConstatScreen
        mode="package"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "Ce sont bien les enregistrements à déposer sur Vigie-Chiro ?",
    );
    expect(frame).not.toContain("à mettre dans le zip ?");
  });

  it("uses the singular form for a single file", async () => {
    await writeProcessedFiles([prefixed("a_001.wav")]);

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 enregistrement trouvé dans ./processed/");
    // Scoped to the count line specifically — the confirmation question
    // below it ("Ce sont bien les enregistrements...") legitimately
    // contains the plural word regardless of count.
    expect(frame).not.toContain("enregistrements trouvés");
    expect(frame).not.toContain("1 enregistrements");
  });

  it("calls onContinue with the scanned entries, total bytes and the prefix the backup is named after on Entrée", async () => {
    await writeProcessedFiles(["a_001.wav", "a_002.wav"].map(prefixed));

    const resultBox: {
      entries: readonly ArchiveEntryStat[] | null;
      totalBytes: number | null;
      prefix: string | null;
    } = { entries: null, totalBytes: null, prefix: null };

    const { stdin, lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={(entries, totalBytes, prefix) => {
          resultBox.entries = entries;
          resultBox.totalBytes = totalBytes;
          resultBox.prefix = prefix;
        }}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));
    stdin.write("\r");
    await waitUntil(() => resultBox.entries !== null);

    expect(resultBox.entries?.map((e) => e.name)).toEqual(
      ["a_001.wav", "a_002.wav"].map(prefixed),
    );
    expect(resultBox.totalBytes).toBe(8);
    expect(resultBox.prefix).toBe("Car340581-2026-Pass1-A1");
  });

  it("calls onBack on Échap", async () => {
    await writeProcessedFiles([prefixed("a_001.wav")]);

    const onBackCalls: number[] = [];
    const { stdin, lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => onBackCalls.push(1)}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));
    stdin.write("\x1b");
    await settle();

    expect(onBackCalls.length).toBe(1);
  });
});

describe("ArchiveConstatScreen — not-writable", () => {
  itUnlessRoot(
    "shows the protected-folder guidance when cwd cannot be written to, backup mode mentions « archived »",
    async () => {
      const processedDir = path.join(tmpDir, "processed");
      await mkdir(processedDir);
      await writeFile(
        path.join(processedDir, "Car340581-2026-Pass1-A1-a_001.wav"),
        "1234",
      );

      await chmod(tmpDir, 0o500);

      const { lastFrame } = render(
        <ConstatScreen
          mode="backup"
          cwd={tmpDir}
          onContinue={() => undefined}
          onBack={() => undefined}
        />,
      );

      await waitUntil(
        () => !(lastFrame() ?? "").includes("Analyse du dossier…"),
      );

      const frame = lastFrame() ?? "";
      expect(frame).toContain(`📁 ${tmpDir}`);
      expect(frame).toContain("Ce dossier est protégé en écriture.");
      expect(frame).toContain("« archived »");
    },
  );

  itUnlessRoot(
    "mentions « upload » instead of « archived » in package mode",
    async () => {
      const processedDir = path.join(tmpDir, "processed");
      await mkdir(processedDir);
      await writeFile(path.join(processedDir, "a_001.wav"), "1234");

      await chmod(tmpDir, 0o500);

      const { lastFrame } = render(
        <ConstatScreen
          mode="package"
          cwd={tmpDir}
          onContinue={() => undefined}
          onBack={() => undefined}
        />,
      );

      await waitUntil(
        () => !(lastFrame() ?? "").includes("Analyse du dossier…"),
      );

      const frame = lastFrame() ?? "";
      expect(frame).toContain("« upload »");
      expect(frame).not.toContain("« archived »");
    },
  );
});

describe("ArchiveConstatScreen — scan-error", () => {
  it("shows the raw error code when 'processed' exists but is not a directory", async () => {
    // No permission trickery (and thus no root skip) needed: readdir on a
    // plain file reliably fails with ENOTDIR, reaching the same
    // `scan-error` branch as a real unexpected I/O failure would.
    await writeFile(path.join(tmpDir, "processed"), "not a directory");

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const frame = lastFrame() ?? "";
    expect(frame).toContain(`📁 ${tmpDir}`);
    expect(frame).toContain(
      "Une erreur inattendue est survenue en lisant ce dossier.",
    );
    expect(frame).toContain("Détail technique : ENOTDIR");
  });
});

describe("ArchiveConstatScreen — package mode orphan cleanup", () => {
  it("removes an orphaned staging dir in upload/ while scanning, before reaching 'ready'", async () => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "a_001.wav"), "1234");

    const uploadDir = path.join(tmpDir, "upload");
    await mkdir(uploadDir);
    // A staging dir whose PID is certainly dead (max PID space is far below
    // this on every real OS) — deterministic without touching `process.kill`.
    const orphanName = ".depot_20200101.999999999.tmpdir";
    await mkdir(path.join(uploadDir, orphanName));
    await writeFile(
      path.join(uploadDir, orphanName, "volume-1.zip"),
      "leftover",
    );

    const { lastFrame } = render(
      <ConstatScreen
        mode="package"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const remaining = await readdir(uploadDir);
    expect(remaining).not.toContain(orphanName);
  });

  it("does not touch upload/ in backup mode", async () => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    await writeFile(
      path.join(processedDir, "Car340581-2026-Pass1-A1-a_001.wav"),
      "1234",
    );

    const uploadDir = path.join(tmpDir, "upload");
    await mkdir(uploadDir);
    const orphanName = ".depot_20200101.999999999.tmpdir";
    await mkdir(path.join(uploadDir, orphanName));

    const { lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    const remaining = await readdir(uploadDir);
    expect(remaining).toContain(orphanName);
  });
});

describe("ArchiveConstatScreen — names with spaces", () => {
  const spaced =
    "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005_000.wav";

  const writeProcessed = async (names: readonly string[]): Promise<void> => {
    await mkdir(path.join(tmpDir, "processed"));
    for (const name of names) {
      await writeFile(path.join(tmpDir, "processed", name), "1234");
    }
  };

  const renderFrame = async (
    mode: "backup" | "package",
    onContinue: () => void = () => undefined,
  ) => {
    const screen = render(
      <ConstatScreen
        mode={mode}
        cwd={tmpDir}
        onContinue={onContinue}
        onBack={() => undefined}
      />,
    );
    await waitUntil(
      () => !(screen.lastFrame() ?? "").includes("Analyse du dossier…"),
    );
    return screen;
  };

  it("blocks the upload and gives the full path back to prefixing, since the portal would refuse the names", async () => {
    await writeProcessed([spaced]);
    await writeFile(
      path.join(
        tmpDir,
        "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005.wav",
      ),
      "",
    );

    const { lastFrame } = await renderFrame("package");
    const frame = lastFrame() ?? "";

    expect(frame).toContain(
      "⚠ 1 enregistrement découpé a un espace dans son nom.",
    );
    expect(frame).toContain("• lancez « Préfixer des enregistrements »");
    expect(frame).toContain("• renommez l'ancien dossier « processed »");
    expect(frame).toContain(
      "• relancez « Découper les enregistrements », puis revenez ici",
    );
  });

  it("drops the prefixing step once the sources no longer hold any space", async () => {
    await writeProcessed([spaced]);
    await writeFile(
      path.join(
        tmpDir,
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
      ),
      "",
    );

    const { lastFrame } = await renderFrame("package");
    const frame = lastFrame() ?? "";

    expect(frame).toContain("• renommez l'ancien dossier « processed »");
    expect(frame).not.toContain("lancez « Préfixer");
  });

  it("does not block the upload for a non-recording file with a space", async () => {
    await writeProcessed(["a_000.wav", "notes terrain.txt"]);

    const { lastFrame } = await renderFrame("package");

    expect(lastFrame() ?? "").toContain(
      "Ce sont bien les enregistrements à déposer",
    );
  });

  it("only warns on the backup and lets her continue, since a backup keeps names as they are", async () => {
    await writeProcessed([spaced, "Car123456-2026-Pass1-Z3-PR01 PR1_000.wav"]);
    let continued = false;

    const { lastFrame, stdin } = await renderFrame("backup", () => {
      continued = true;
    });
    const frame = lastFrame() ?? "";
    stdin.write("\r");
    await waitUntil(() => continued);

    expect(frame).toContain("⚠ 2 enregistrements ont un espace dans leur nom.");
    expect(frame).toContain(
      "Ils seront sauvegardés tels quels. Pour les déposer sur",
    );
    expect(frame).toContain(
      "Vigie-Chiro, il faudra d'abord remplacer ces espaces.",
    );
  });

  it("renames nothing in processed/ while it reports spaces", async () => {
    await writeProcessed([spaced]);

    await renderFrame("package");

    expect(await readdir(path.join(tmpDir, "processed"))).toEqual([spaced]);
  });

  it("uses the plural when several cut recordings hold a space", async () => {
    await writeProcessed([spaced, "Car123456-2026-Pass1-Z3-PR01 PR1_000.wav"]);

    const { lastFrame } = await renderFrame("package");

    expect(lastFrame() ?? "").toContain(
      "⚠ 2 enregistrements découpés ont un espace dans leur nom.",
    );
  });

  itUnlessRoot(
    "keeps the prefixing step when the sources cannot be read, rather than guessing they are fixed",
    async () => {
      await writeProcessed([spaced]);
      await chmod(tmpDir, 0o555);

      const { lastFrame } = await renderFrame("package");

      expect(lastFrame() ?? "").toContain(
        "• lancez « Préfixer des enregistrements »",
      );
    },
  );

  it("warns in the singular on the backup", async () => {
    await writeProcessed([spaced]);

    const { lastFrame } = await renderFrame("backup");
    const frame = lastFrame() ?? "";

    expect(frame).toContain("⚠ 1 enregistrement a un espace dans son nom.");
    expect(frame).toContain("Il sera sauvegardé tel quel. Pour le déposer sur");
    expect(frame).toContain(
      "Vigie-Chiro, il faudra d'abord remplacer cet espace.",
    );
  });
});

describe("ArchiveConstatScreen — no common Vigie-Chiro prefix", () => {
  const writeProcessed = async (names: readonly string[]): Promise<void> => {
    await mkdir(path.join(tmpDir, "processed"));
    for (const name of names) {
      await writeFile(path.join(tmpDir, "processed", name), "1234");
    }
  };

  const renderBackup = async (onContinue: () => void = () => undefined) => {
    const screen = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={onContinue}
        onBack={() => undefined}
      />,
    );
    await waitUntil(
      () => !(screen.lastFrame() ?? "").includes("Analyse du dossier…"),
    );
    return screen;
  };

  it("refuses to back up unprefixed recordings and gives the path back to prefixing, since two such folders would share one name online", async () => {
    await writeProcessed([
      "PaRec123_20261025_210000_000.wav",
      "PaRec123_20261025_210000_001.wav",
    ]);
    await writeFile(path.join(tmpDir, "PaRec123_20261025_210000.wav"), "");

    const { lastFrame } = await renderBackup();

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "⚠ Ces enregistrements n'ont pas tous le même préfixe Vigie-Chiro.",
    );
    expect(frame).toContain(
      "chiro nomme la sauvegarde d'après ce préfixe. Pour l'ajouter :",
    );
    expect(frame).toContain("• lancez « Préfixer des enregistrements »");
    expect(frame).toContain("• renommez l'ancien dossier « processed »");
    expect(frame).toContain(
      "• relancez « Découper les enregistrements », puis revenez ici",
    );
    expect(frame).not.toContain("Entrée");
  });

  it("refuses recordings from two passes with the same message, since they share no single prefix", async () => {
    await writeProcessed([
      "Car123456-2026-Pass1-A1-x_000.wav",
      "Car123456-2026-Pass2-A1-y_000.wav",
    ]);

    const { lastFrame } = await renderBackup();

    expect(lastFrame() ?? "").toContain(
      "⚠ Ces enregistrements n'ont pas tous le même préfixe Vigie-Chiro.",
    );
  });

  it("drops the prefixing step once every source is already prefixed, since prefixing again would find nothing to do", async () => {
    await writeProcessed(["PaRec123_20261025_210000_000.wav"]);
    await mkdir(path.join(tmpDir, "Brut"));
    await writeFile(
      path.join(
        tmpDir,
        "Brut",
        "Car340581-2026-Pass1-A1-PaRec123_20261025_210000.wav",
      ),
      "",
    );

    const { lastFrame } = await renderBackup();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("• renommez l'ancien dossier « processed »");
    expect(frame).not.toContain("Préfixer des enregistrements");
  });

  it("drops the prefixing step for sources prefixed on two passes, since prefixing would find nothing to do there either", async () => {
    await writeProcessed([
      "Car123456-2026-Pass1-A1-x_000.wav",
      "Car123456-2026-Pass2-A1-y_000.wav",
    ]);
    await writeFile(path.join(tmpDir, "Car123456-2026-Pass1-A1-x.wav"), "");
    await writeFile(path.join(tmpDir, "Car123456-2026-Pass2-A1-y.wav"), "");

    const { lastFrame } = await renderBackup();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("n'ont pas tous le même préfixe Vigie-Chiro");
    expect(frame).not.toContain("Préfixer des enregistrements");
  });

  it("never continues to the confirmation on Entrée while it refuses", async () => {
    await writeProcessed(["PaRec123_20261025_210000_000.wav"]);
    const calls: number[] = [];

    const { stdin } = await renderBackup(() => calls.push(1));
    stdin.write("\r");
    await settle();

    expect(calls).toEqual([]);
  });

  itUnlessRoot(
    "refuses before checking the folder can be written to, and keeps the prefixing step when the sources cannot be read",
    async () => {
      await writeProcessed(["PaRec123_20261025_210000_000.wav"]);
      await chmod(tmpDir, 0o500);

      const { lastFrame } = await renderBackup();

      const frame = lastFrame() ?? "";
      expect(frame).toContain("n'ont pas tous le même préfixe Vigie-Chiro");
      expect(frame).not.toContain("protégé en écriture");
      expect(frame).toContain("• lancez « Préfixer des enregistrements »");
    },
  );

  it("leaves the upload flow unchanged, since its series falls back to a local depot_ name", async () => {
    await writeProcessed(["PaRec123_20261025_210000_000.wav"]);
    const continued: number[] = [];

    const { stdin, lastFrame } = render(
      <ConstatScreen
        mode="package"
        cwd={tmpDir}
        onContinue={() => continued.push(1)}
        onBack={() => undefined}
      />,
    );
    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));

    expect(lastFrame() ?? "").toContain(
      "1 enregistrement trouvé dans ./processed/",
    );
    stdin.write("\r");
    await waitUntil(() => continued.length === 1);
  });
});
