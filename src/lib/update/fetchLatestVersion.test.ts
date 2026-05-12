import { describe, expect, it, vi } from "vitest";
import { fetchLatestVersion } from "./fetchLatestVersion.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const makeJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const makeTextResponse = (body: string, status = 200): Response =>
  new Response(body, { status });

describe("fetchLatestVersion — nominal case", () => {
  it("returns ok with tagName when the API responds with a valid tag_name", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ tag_name: "v0.2.0" }),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "ok", tagName: "v0.2.0" });
    expect(vi.mocked(mockFetch)).toHaveBeenCalledOnce();
  });

  it("sends correct headers to the GitHub API", async () => {
    const calls: [string, RequestInit][] = [];
    const mockFetch: FetchFn = (url, init) => {
      calls.push([url, init ?? {}]);
      return Promise.resolve(makeJsonResponse({ tag_name: "v0.1.0" }));
    };

    await fetchLatestVersion({ fetch: mockFetch });

    const call = calls[0];
    const init = call?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("chiro-cli");
    expect(headers?.Accept).toBe("application/vnd.github+json");
  });
});

describe("fetchLatestVersion — HTTP error codes", () => {
  it("returns http-403 on 403 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeTextResponse("Forbidden", 403),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "http-403" });
  });

  it("returns http-404 on 404 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeTextResponse("Not Found", 404),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "http-404" });
  });

  it("returns parse on other non-200 status codes", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeTextResponse("Server Error", 500),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "parse" });
  });
});

describe("fetchLatestVersion — parse errors", () => {
  it("returns parse when body is not valid JSON", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeTextResponse("not-json")) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "parse" });
  });

  it("returns parse when tag_name is absent from the JSON", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ name: "Release", body: "notes" }),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "parse" });
  });

  it("returns parse when tag_name is not a string", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ tag_name: 42 }),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "parse" });
  });

  it("returns parse when tag_name is an empty string", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ tag_name: "" }),
      ) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "parse" });
  });
});

describe("fetchLatestVersion — network and timeout errors", () => {
  it("returns timeout when fetch throws a TimeoutError", async () => {
    const timeoutError = new Error("signal timed out");
    timeoutError.name = "TimeoutError";

    const mockFetch = vi
      .fn()
      .mockRejectedValue(timeoutError) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "timeout" });
  });

  it("returns timeout when fetch throws an AbortError and the caller signal already timed out", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    // Build a signal that is already aborted with a TimeoutError reason,
    // simulating what AbortSignal.timeout produces after it fires.
    const controller = new AbortController();
    const timeoutReason = new Error("signal timed out");
    timeoutReason.name = "TimeoutError";
    controller.abort(timeoutReason);
    const alreadyTimedOutSignal = controller.signal;

    const mockFetch = vi
      .fn()
      .mockRejectedValue(abortError) as unknown as FetchFn;

    const result = await fetchLatestVersion({
      fetch: mockFetch,
      signal: alreadyTimedOutSignal,
    });

    expect(result).toEqual({ kind: "error", code: "timeout" });
  });

  it("returns network on generic fetch errors (DNS, connection refused)", async () => {
    const networkError = new Error("fetch failed");
    networkError.name = "TypeError";

    const mockFetch = vi
      .fn()
      .mockRejectedValue(networkError) as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "network" });
  });

  it("returns network when fetch throws a non-Error value (string)", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue("string thrown") as unknown as FetchFn;

    const result = await fetchLatestVersion({ fetch: mockFetch });

    expect(result).toEqual({ kind: "error", code: "network" });
  });
});

describe("fetchLatestVersion — global fetch fallback", () => {
  it("falls back to global fetch when opts.fetch is not provided", async () => {
    const stubFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ tag_name: "v0.9.0" })));
    vi.stubGlobal("fetch", stubFetch);

    try {
      const result = await fetchLatestVersion();
      expect(result).toEqual({ kind: "ok", tagName: "v0.9.0" });
      expect(stubFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
