import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult } from "../lib/update/fetchLatestVersion.js";
import type { UpdateChecker } from "./UpdateScreen.js";
import { UpdateScreen } from "./UpdateScreen.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopRef = { current: false };

const makeChecker =
  (result: FetchResult): UpdateChecker =>
  () =>
    Promise.resolve(result);

const neverChecker: UpdateChecker = () => new Promise(() => undefined);

/** Drain the microtask queue so resolved promises flush into React state. */
const waitForFrame = async (): Promise<void> => {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
};

/** Wait for Ink's escape-key flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

// ---------------------------------------------------------------------------
// updateErrorMessages — pure function tests (bundled here per spec)
// ---------------------------------------------------------------------------

describe("updateErrorMessages", () => {
  // Import lazily to keep tests self-contained.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let getErrorTitle: (typeof import("./updateErrorMessages.js"))["getErrorTitle"];
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let getErrorHint: (typeof import("./updateErrorMessages.js"))["getErrorHint"];
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let getErrorLabel: (typeof import("./updateErrorMessages.js"))["getErrorLabel"];

  beforeEach(async () => {
    const mod = await import("./updateErrorMessages.js");
    getErrorTitle = mod.getErrorTitle;
    getErrorHint = mod.getErrorHint;
    getErrorLabel = mod.getErrorLabel;
  });

  it.each([
    ["network", "Impossible de vérifier la dernière version."],
    ["timeout", "Impossible de vérifier la dernière version."],
    ["http-403", "GitHub bloque temporairement les vérifications."],
    ["http-404", "Impossible de vérifier la dernière version."],
    ["parse", "Impossible de vérifier la dernière version."],
    ["parse-local", "Impossible de comparer les versions."],
  ] as const)("getErrorTitle(%s)", (code, expected) => {
    expect(getErrorTitle(code)).toBe(expected);
  });

  it.each([
    ["network", "Vérifiez votre connexion internet, puis réessayez."],
    ["timeout", "Vérifiez votre connexion internet, puis réessayez."],
    [
      "http-403",
      "C'est normal si vous lancez chiro très souvent.\nRéessayez dans une heure.",
    ],
    ["http-404", "Aucune version publiée. Contactez le développeur."],
    ["parse", "Réessayez ; si le problème persiste, contactez le développeur."],
    [
      "parse-local",
      "Réinstallez chiro depuis https://github.com/zaratan/chiro-tools.",
    ],
  ] as const)("getErrorHint(%s)", (code, expected) => {
    expect(getErrorHint(code)).toBe(expected);
  });

  it.each([
    ["network", "pas de connexion"],
    ["timeout", "délai dépassé"],
    ["http-403", "quota GitHub atteint"],
    ["http-404", "aucune version publiée"],
    ["parse", "réponse inattendue"],
    ["parse-local", "version locale illisible"],
  ] as const)("getErrorLabel(%s)", (code, expected) => {
    expect(getErrorLabel(code)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// UpdateScreen — component tests
// ---------------------------------------------------------------------------

describe("UpdateScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial / checking state
  // -------------------------------------------------------------------------

  it("shows the checking message before the promise resolves", () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={neverChecker}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Vérification de la dernière version…");
    expect(frame).toContain("Échap retour au menu");
  });

  it("sets runningRef.current to true while checking", () => {
    const ref = { current: false };
    render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={ref}
        checker={neverChecker}
      />,
    );
    expect(ref.current).toBe(true);
  });

  // -------------------------------------------------------------------------
  // up-to-date state
  // -------------------------------------------------------------------------

  it("transitions to up-to-date when remote version equals local", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.1.0" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓");
    expect(frame).toContain("Vous êtes à jour.");
    expect(frame).toContain("Échap retour au menu");
  });

  it("clears runningRef.current after transitioning to up-to-date", async () => {
    const ref = { current: false };
    render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={ref}
        checker={makeChecker({ kind: "ok", tagName: "v0.1.0" })}
      />,
    );
    await waitForFrame();
    expect(ref.current).toBe(false);
  });

  // -------------------------------------------------------------------------
  // available state
  // -------------------------------------------------------------------------

  it("transitions to available when remote version is newer", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.2.0" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Une nouvelle version est disponible : ");
    expect(frame).toContain("v0.2.0");
    expect(frame).toContain("chiro lance l'installation puis se ferme");
    expect(frame).toContain("Entrée installer");
    expect(frame).toContain("Échap retour au menu");
  });

  it("clears runningRef.current after transitioning to available", async () => {
    const ref = { current: false };
    render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={ref}
        checker={makeChecker({ kind: "ok", tagName: "v0.2.0" })}
      />,
    );
    await waitForFrame();
    expect(ref.current).toBe(false);
  });

  // -------------------------------------------------------------------------
  // error states
  // -------------------------------------------------------------------------

  it("transitions to error state on network error", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "error", code: "network" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("⚠");
    expect(frame).toContain("Impossible de vérifier la dernière version.");
    expect(frame).toContain("pas de connexion (network)");
    expect(frame).toContain("Vérifiez votre connexion internet");
  });

  it("shows dedicated http-403 message", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "error", code: "http-403" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("GitHub bloque temporairement les vérifications.");
    expect(frame).toContain("quota GitHub atteint (http-403)");
    expect(frame).toContain("Réessayez dans une heure.");
  });

  it("transitions to error with parse-local when currentVersion is invalid", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="not-a-version"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.2.0" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Impossible de comparer les versions.");
    expect(frame).toContain("version locale illisible (parse-local)");
  });

  it("transitions to error with parse when remote tagName is invalid", async () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "not-a-version" })}
      />,
    );
    await waitForFrame();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Impossible de vérifier la dernière version.");
    expect(frame).toContain("réponse inattendue (parse)");
  });

  // -------------------------------------------------------------------------
  // Keyboard — onBack
  // -------------------------------------------------------------------------

  it("calls onBack on Escape while checking", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={onBack}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={neverChecker}
      />,
    );
    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onBack on Escape while up-to-date", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={onBack}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.1.0" })}
      />,
    );
    await waitForFrame();
    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onBack on Escape while available", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={onBack}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.2.0" })}
      />,
    );
    await waitForFrame();
    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onBack on Escape while in error state", async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={onBack}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={makeChecker({ kind: "error", code: "network" })}
      />,
    );
    await waitForFrame();
    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Keyboard — onRequestInstall
  // -------------------------------------------------------------------------

  it("calls onRequestInstall on Enter when available", async () => {
    const onRequestInstall = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={onRequestInstall}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.2.0" })}
      />,
    );
    await waitForFrame();
    stdin.write("\r");
    await settle();
    expect(onRequestInstall).toHaveBeenCalledOnce();
  });

  it("does NOT call onRequestInstall on Enter while checking", async () => {
    const onRequestInstall = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={onRequestInstall}
        runningRef={noopRef}
        checker={neverChecker}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onRequestInstall).not.toHaveBeenCalled();
  });

  it("does NOT call onRequestInstall on Enter when up-to-date", async () => {
    const onRequestInstall = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={onRequestInstall}
        runningRef={noopRef}
        checker={makeChecker({ kind: "ok", tagName: "v0.1.0" })}
      />,
    );
    await waitForFrame();
    stdin.write("\r");
    await settle();
    expect(onRequestInstall).not.toHaveBeenCalled();
  });

  it("does NOT call onRequestInstall on Enter when in error state", async () => {
    const onRequestInstall = vi.fn();
    const { stdin } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={onRequestInstall}
        runningRef={noopRef}
        checker={makeChecker({ kind: "error", code: "network" })}
      />,
    );
    await waitForFrame();
    stdin.write("\r");
    await settle();
    expect(onRequestInstall).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // AbortController — signal aborted on unmount
  // -------------------------------------------------------------------------

  it("aborts the signal when unmounted during checking", () => {
    let capturedSignal: AbortSignal | undefined;
    const blockingChecker: UpdateChecker = (opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => undefined);
    };
    const { unmount } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={blockingChecker}
      />,
    );
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("clears runningRef on unmount", () => {
    const ref = { current: false };
    const { unmount } = render(
      <UpdateScreen
        currentVersion="0.1.0"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={ref}
        checker={neverChecker}
      />,
    );
    expect(ref.current).toBe(true);
    unmount();
    expect(ref.current).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  it("includes the current version in the header", () => {
    const { lastFrame } = render(
      <UpdateScreen
        currentVersion="1.2.3"
        onBack={() => undefined}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={neverChecker}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("chiro v1.2.3 — mise à jour");
  });

  // -------------------------------------------------------------------------
  // autoUpdateDisabled mode
  // -------------------------------------------------------------------------

  it("shows the Homebrew message, never calls checker, and Échap returns when autoUpdateDisabled=true", async () => {
    const checker = vi.fn();
    const onBack = vi.fn();
    const { stdin, lastFrame } = render(
      <UpdateScreen
        currentVersion="0.1.7"
        onBack={onBack}
        onRequestInstall={() => undefined}
        runningRef={noopRef}
        checker={checker}
        autoUpdateDisabled={true}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "chiro a été installé via Homebrew sur cet ordinateur.",
    );
    expect(frame).toContain("Les mises à jour passent donc par Homebrew.");
    expect(frame).toContain("brew upgrade chiro");
    expect(frame).toContain("Échap retour au menu");
    expect(checker).not.toHaveBeenCalled();

    stdin.write("\x1b");
    await settle();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
