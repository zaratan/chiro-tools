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
    await writeProcessedFiles(["a_001.wav", "a_002.wav", "a_003.wav"]);

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
    await writeProcessedFiles(["a_001.wav"]);

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
    await writeProcessedFiles(["a_001.wav"]);

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

  it("calls onContinue with the scanned entries and total bytes on Entrée", async () => {
    await writeProcessedFiles(["a_001.wav", "a_002.wav"]);

    const resultBox: {
      entries: readonly ArchiveEntryStat[] | null;
      totalBytes: number | null;
    } = { entries: null, totalBytes: null };

    const { stdin, lastFrame } = render(
      <ConstatScreen
        mode="backup"
        cwd={tmpDir}
        onContinue={(entries, totalBytes) => {
          resultBox.entries = entries;
          resultBox.totalBytes = totalBytes;
        }}
        onBack={() => undefined}
      />,
    );

    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));
    stdin.write("\r");
    await waitUntil(() => resultBox.entries !== null);

    expect(resultBox.entries?.map((e) => e.name)).toEqual([
      "a_001.wav",
      "a_002.wav",
    ]);
    expect(resultBox.totalBytes).toBe(8);
  });

  it("calls onBack on Échap", async () => {
    await writeProcessedFiles(["a_001.wav"]);

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
      await writeFile(path.join(processedDir, "a_001.wav"), "1234");

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
    await writeFile(path.join(processedDir, "a_001.wav"), "1234");

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
