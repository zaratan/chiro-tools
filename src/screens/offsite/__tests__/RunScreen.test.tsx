import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ChosenArchive } from "../../../lib/offsite/pickArchiveToUpload.js";
import type { OffsiteSettings } from "../../../lib/offsite/settings.js";
import type { UploadArchiveResult } from "../../../lib/offsite/uploadArchive.js";
import { RunScreen } from "../RunScreen.js";
import type { UploadArchiveFn } from "../useOffsiteRun.js";

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const chosen: ChosenArchive = {
  name: "Car340581-2026-Pass1-A1_20260814.zip",
  path: "/tmp/chiro-demo/archived/Car340581-2026-Pass1-A1_20260814.zip",
  size: 4,
  mtimeMs: 0,
};

const settings: OffsiteSettings = {
  remote: "chiro-remote",
  bucket: "chiro-bucket",
  prefix: "vigie",
};

describe("RunScreen — running/stopping wiring", () => {
  it("shows RunningView while running, and Ctrl+C moves to the 'Arrêt en cours…' screen", async () => {
    const uploadArchive: UploadArchiveFn = (_deps, options) =>
      new Promise<UploadArchiveResult>((resolve) => {
        options.signal?.addEventListener("abort", () => {
          resolve({ kind: "aborted", bytesSent: 0 });
        });
      });

    const { lastFrame, stdin } = render(
      <RunScreen
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={{ current: false }}
        uploadArchive={uploadArchive}
        onComplete={() => undefined}
        onBackToStart={() => undefined}
      />,
    );

    expect(lastFrame() ?? "").toContain("Archivage en ligne en cours…");

    stdin.write("\x03"); // Ctrl+C
    await settle();

    expect(lastFrame() ?? "").toContain("Arrêt en cours…");
  });

  it("a second Ctrl+C while stopping is harmless (no crash, no double abort)", async () => {
    let abortCalls = 0;
    const uploadArchive: UploadArchiveFn = (_deps, options) =>
      new Promise<UploadArchiveResult>((resolve) => {
        options.signal?.addEventListener("abort", () => {
          abortCalls++;
          resolve({ kind: "aborted", bytesSent: 0 });
        });
      });

    const { lastFrame, stdin } = render(
      <RunScreen
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={{ current: false }}
        uploadArchive={uploadArchive}
        onComplete={() => undefined}
        onBackToStart={() => undefined}
      />,
    );

    stdin.write("\x03");
    await settle();
    stdin.write("\x03");
    await settle();

    expect(lastFrame() ?? "").toContain("Arrêt en cours…");
    expect(abortCalls).toBe(1);
  });

  it("calls onComplete with the ok outcome once the transfer finishes", async () => {
    const onComplete = vi.fn();
    const uploadArchive: UploadArchiveFn = () =>
      Promise.resolve({
        kind: "ok",
        bytesSent: 4,
        attempts: 1,
        verified: "size-match",
      });

    render(
      <RunScreen
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={{ current: false }}
        uploadArchive={uploadArchive}
        onComplete={onComplete}
        onBackToStart={() => undefined}
      />,
    );

    await waitUntil(() => onComplete.mock.calls.length > 0);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ok", verified: "size-match" }),
    );
  });
});

describe("RunScreen — run-error rendered in place", () => {
  it("shows the ResultScreen error variant, and Entrée retries without leaving the screen", async () => {
    let calls = 0;
    const uploadArchive: UploadArchiveFn = () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          kind: "error",
          code: "transient",
          bytesSent: 0,
          fatalError: false,
        });
      }
      return Promise.resolve({
        kind: "ok",
        bytesSent: 4,
        attempts: 1,
        verified: "size-match",
      });
    };
    const onComplete = vi.fn();

    const { lastFrame, stdin } = render(
      <RunScreen
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={{ current: false }}
        uploadArchive={uploadArchive}
        onComplete={onComplete}
        onBackToStart={() => undefined}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant l'archivage en ligne",
      ),
    );
    await settle();
    expect(lastFrame() ?? "").toContain("Entrée réessayer");

    stdin.write("\r");
    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(calls).toBe(2);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ok" }),
    );
  });

  it("Échap on the error screen calls onBackToStart", async () => {
    const onBackToStart = vi.fn();
    const uploadArchive: UploadArchiveFn = () =>
      Promise.resolve({
        kind: "error",
        code: "fatal",
        bytesSent: 0,
        fatalError: true,
      });

    const { lastFrame, stdin } = render(
      <RunScreen
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={{ current: false }}
        uploadArchive={uploadArchive}
        onComplete={() => undefined}
        onBackToStart={onBackToStart}
      />,
    );

    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant l'archivage en ligne",
      ),
    );

    stdin.write("\u001b");
    await settle();

    expect(onBackToStart).toHaveBeenCalledTimes(1);
  });
});
