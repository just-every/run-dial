import { useEffect, useState } from "react";
import { errorMessage } from "../../../api/client";
import { useWorkspaceRead, workspaceFetch } from "../../../app/workspace-reads";

/** URL changes retire the previous read before it can disclose another client's history. */
export function useClientRead<T>(path: string | undefined, revision = 0) {
  const initial = useWorkspaceRead<T>(path ?? "/api/app/clients/not-selected");
  const [result, setResult] = useState<{ path?: string; revision: number; data?: T; error?: string }>({ path, revision, data: initial });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await workspaceFetch(path, { signal: controller.signal });
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json() as T;
        if (!controller.signal.aborted) setResult({ path, revision, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ path, revision, error: error instanceof Error ? error.message : "Client history could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [path, revision]);
  const current = result.path === path && result.revision === revision;
  return { data: current ? result.data : initial, error: current ? result.error : undefined, loading: Boolean(path) && !(current ? result.data || result.error : initial) };
}
