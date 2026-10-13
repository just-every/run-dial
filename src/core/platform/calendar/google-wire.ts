import { ProviderFailure } from "./types";

/** HTTP boundary for Google Calendar: maps transport details to sanitised errors. */
export async function requestWithTimeout(request: typeof fetch, input: RequestInfo | URL, init?: RequestInit, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(input, { ...init, signal: controller.signal });
    if (!response.ok) throw responseFailure(response.status);
    return response;
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ProviderFailure("provider_timeout", true);
    throw new ProviderFailure("provider_unavailable", true);
  } finally {
    clearTimeout(timeout);
  }
}

export function requestJsonWithTimeout(request: typeof fetch, input: RequestInfo | URL, init?: RequestInit, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return boundedJson(request, input, init, timeoutMs, false) as Promise<Record<string, unknown>>;
}
export function requestOptionalJsonWithTimeout(request: typeof fetch, input: RequestInfo | URL, init?: RequestInit, timeoutMs = 5_000) {
  return boundedJson(request, input, init, timeoutMs, true);
}
async function boundedJson(request: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number, allowMissing: boolean): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(input, { ...init, signal: controller.signal });
    if (allowMissing && (response.status === 404 || response.status === 410)) return undefined;
    if (!response.ok) throw responseFailure(response.status);
    return await raceAbort(providerJson(response), controller.signal);
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ProviderFailure("provider_timeout", true);
    throw new ProviderFailure("provider_unavailable", true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function providerJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) throw new Error("expected an object");
    return value;
  } catch {
    throw new ProviderFailure("invalid_provider_response", false);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("The operation timed out", "AbortError")), { once: true })),
  ]);
}

function responseFailure(status: number) {
  if (status === 401) return new ProviderFailure("unauthorized", false);
  if (status === 403) return new ProviderFailure("forbidden", false);
  if (status === 409 || status === 412) return new ProviderFailure("provider_write_conflict", true);
  if (status === 429) return new ProviderFailure("quota_exhausted", true);
  if (status === 410) return new ProviderFailure("invalid_sync_cursor", false);
  return new ProviderFailure("provider_unavailable", status >= 500);
}
