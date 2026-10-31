import { useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { useWorkspaceResponse, workspaceFetch } from "./workspace-reads";

type Result<T> = { path?: string; revision: number; data?: T; missing?: boolean; error?: string };

/**
 * One record's native read. Its first render comes from the navigation's own read; a reload keeps the record on screen until
 * the new answer arrives (U9), a 400 or 404 says the record does not exist, and another path never inherits this one's data.
 */
export function useRecordRead<T>(path: string | undefined, revision = 0) {
  const initial = useWorkspaceResponse<T>(path);
  const [result, setResult] = useState<Result<T>>({ path, revision, data: initial?.data, missing: initial && [400, 404].includes(initial.status) });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await workspaceFetch(path, { signal: controller.signal });
        if (response.status === 400 || response.status === 404) { if (!controller.signal.aborted) setResult({ path, revision, missing: true }); return; }
        if (!response.ok) throw new Error(await errorMessage(response));
        const data = await response.json() as T;
        if (!controller.signal.aborted) setResult({ path, revision, data });
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "This record could not be loaded.";
        setResult(current => current.path === path ? { ...current, revision, error: message } : { path, revision, error: message });
      }
    })();
    return () => controller.abort();
  }, [path, revision]);
  const same = result.path === path;
  return {
    /** The revision whose answer (data, missing or error) is in; -1 until this path's first answer. */
    settled: same ? result.revision : -1,
    data: same ? result.data : initial?.data,
    missing: Boolean(path) && Boolean(same ? result.missing : initial && [400, 404].includes(initial.status)),
    error: same && result.revision === revision ? result.error : undefined,
  };
}
