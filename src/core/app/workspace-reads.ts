import { useContext, createContext } from "react";

export type WorkspaceReads = Record<string, { body: string; status: number; headers: Record<string, string> }>;
export const WorkspaceReadsContext = createContext<WorkspaceReads>({});

export function readKey(input: string) {
  const url = new URL(input, "http://dial.invalid");
  url.searchParams.sort();
  return url.pathname + url.search;
}

/** The current navigation's native responses, useful for populated first render. */
export function useWorkspaceRead<T>(path: string): T | undefined {
  const response = useContext(WorkspaceReadsContext)[readKey(path)];
  return response && response.status < 400 ? JSON.parse(response.body) as T : undefined;
}

export function useWorkspaceHeader(path: string, name: string) {
  return useContext(WorkspaceReadsContext)[readKey(path)]?.headers[name.toLowerCase()];
}

let installed: WorkspaceReads | undefined;
let remaining = new Map<string, WorkspaceReads[string]>();
const pending = new Map<string, Promise<Response>>();

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
  const existing = pending.get(key);
  if (existing) return existing.then(response => response.clone());
  const initial = remaining.get(key);
  remaining.delete(key);
  const request = initial
    ? Promise.resolve(new Response(initial.body, { status: initial.status, headers: initial.headers }))
    : globalThis.fetch(input, init);
  pending.set(key, request);
  void request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
  return request.then(response => response.clone());
};
