import { useContext, createContext, useMemo } from "react";

export type WorkspaceRead = { body: string; status: number; headers: Record<string, string> };
export type WorkspaceReads = Record<string, WorkspaceRead | Promise<WorkspaceRead>>;
export const WorkspaceReadsContext = createContext<WorkspaceReads>({});
export const workspaceReadTimeout = 10_000;

/** Bound an active read, including its body, without giving it ownership of another read's signal. */
export function boundedWorkspaceRead<T>(read: (signal: AbortSignal) => T | PromiseLike<T>, signal?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => controller.abort(new Error("The workspace read timed out.")), workspaceReadTimeout);
  let rejectAborted: () => void;
  const request = new Promise<T>((resolve, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    if (!controller.signal.aborted) Promise.resolve().then(() => read(controller.signal)).then(resolve, reject);
  });
  return request.finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", rejectAborted);
  });
}

export function readKey(input: string) {
  const url = new URL(input, "http://dial.invalid");
  url.searchParams.sort();
  return url.pathname + url.search;
}

/** The current navigation's native responses, useful for populated first render. */
export function useWorkspaceRead<T>(path: string): T | undefined {
  const response = useContext(WorkspaceReadsContext)[readKey(path)];
  return useMemo(() => response && !(response instanceof Promise) && response.status < 400 ? JSON.parse(response.body) as T : undefined, [response]);
}

export function useWorkspaceHeader(path: string, name: string) {
  const response = useContext(WorkspaceReadsContext)[readKey(path)];
  return response && !(response instanceof Promise) ? response.headers[name.toLowerCase()] : undefined;
}

let installed: WorkspaceReads | undefined;
let remaining = new Map<string, WorkspaceReads[string]>();
const pending = new Map<string, Promise<Response>>();
let retryRevision = 0;

export function workspaceReadRevision() { return retryRevision; }

/** Only an explicit Retry replaces mounted page state; normal navigation and writes do not. */
export function retryWorkspaceReads() {
  clearWorkspaceReads();
  return ++retryRevision;
}

export function installWorkspaceReads(reads: WorkspaceReads) {
  if (installed === reads) return;
  clearWorkspaceReads();
  installed = reads;
  remaining = new Map(Object.entries(reads));
}

export function clearWorkspaceReads() {
  installed = undefined;
  remaining.clear();
  pending.clear();
}

/** Consume each fresh navigation response once; later reads always go to the API. */
export const workspaceFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") {
    clearWorkspaceReads();
    return globalThis.fetch(input, init);
  }
  const key = readKey(input instanceof Request ? input.url : String(input));
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  if (signal?.aborted) return Promise.reject(signal.reason);
  // Independently cancellable consumers never share an aborted transport.
  const existing = !signal && pending.get(key);
  if (existing) return existing.then(response => response.clone());
  const initial = remaining.get(key);
  remaining.delete(key);
  const request = boundedWorkspaceRead(async transportSignal => {
    if (initial) {
      const response = await initial;
      if (response.status >= 500) throw new Error("The workspace read failed.");
      return new Response(response.body, { status: response.status, headers: response.headers });
    }
    const response = await globalThis.fetch(input, { ...init, signal: transportSignal });
    if (response.status >= 500) throw new Error("The workspace read failed.");
    // Fetch resolves at the headers. Keep the same deadline through a stalled body.
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }, signal);
  if (!signal) {
    pending.set(key, request);
    void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
  }
  return request.then(response => response.clone());
};
