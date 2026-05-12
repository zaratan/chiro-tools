import { RELEASES_API_URL, UPDATE_FETCH_TIMEOUT_MS } from "./constants.js";

export type FetchErrorCode =
  | "network"
  | "timeout"
  | "http-403"
  | "http-404"
  | "parse";

export type FetchResult =
  | { kind: "ok"; tagName: string }
  | { kind: "error"; code: FetchErrorCode };

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

type FetchLatestVersionOptions = {
  fetch?: FetchFn;
  signal?: AbortSignal;
};

const GITHUB_HEADERS = {
  "User-Agent": "chiro-cli",
  Accept: "application/vnd.github+json",
};

const isTimeoutReason = (reason: unknown): boolean =>
  reason instanceof Error && reason.name === "TimeoutError";

/**
 * Determines whether a fetch error is a timeout rather than a generic abort
 * or network failure.
 *
 * The combined signal's reason is checked: when a caller's AbortSignal.timeout
 * fires, AbortSignal.any propagates its TimeoutError reason to the combined
 * signal, so inspecting combinedSignal.reason is sufficient.
 */
const isTimeoutError = (err: unknown, combinedSignal: AbortSignal): boolean => {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  return err.name === "AbortError" && isTimeoutReason(combinedSignal.reason);
};

const parseTagName = async (response: Response): Promise<FetchResult> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "error", code: "parse" };
  }

  if (typeof body !== "object" || body === null || !("tag_name" in body)) {
    return { kind: "error", code: "parse" };
  }

  const tagName = (body as Record<string, unknown>).tag_name;
  if (typeof tagName !== "string" || tagName === "") {
    return { kind: "error", code: "parse" };
  }

  return { kind: "ok", tagName };
};

/**
 * Fetches the latest GitHub release tag for the chiro-tools repository.
 *
 * - Injects `fetch` for testability (defaults to global fetch).
 * - Combines the caller's AbortSignal with an internal timeout signal so the
 *   request is bounded even if no external signal is provided.
 * - Never throws: all error conditions are returned as tagged error results.
 */
export const fetchLatestVersion = async (
  opts?: FetchLatestVersionOptions,
): Promise<FetchResult> => {
  const fetchFn = opts?.fetch ?? fetch;
  const callerSignal = opts?.signal;

  const timeoutSignal = AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS);
  const combinedSignal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetchFn(RELEASES_API_URL, {
      headers: GITHUB_HEADERS,
      signal: combinedSignal,
    });
  } catch (err) {
    if (isTimeoutError(err, combinedSignal)) {
      return { kind: "error", code: "timeout" };
    }
    return { kind: "error", code: "network" };
  }

  if (response.status === 403) return { kind: "error", code: "http-403" };
  if (response.status === 404) return { kind: "error", code: "http-404" };
  if (!response.ok) return { kind: "error", code: "parse" };

  return parseTagName(response);
};
