import { useEffect } from "react";
import { configLoader, createOwnerEditor } from "../../../../modules/editor/index";
import type { Session } from "../../../../modules/operator-auth/index.mjs";

/** One native app shell owns the widget and rechecks its short lease. */
export function OwnerEditorShell() {
  useEffect(() => {
    const editor = createOwnerEditor();
    const loadConfig = configLoader("/api/editor/config", location.origin);
    let identity = "", pending = false, queued = false, stopped = false, generation = 0;
    let controller: AbortController | undefined;
    const revoke = () => { generation++; controller?.abort(); identity = ""; editor.setOwner(false); };
    const refresh = async () => {
      if (stopped) return;
      if (pending) { queued = true; return; }
      pending = true;
      const currentGeneration = generation;
      const request = new AbortController(); controller = request;
      try {
        const response = await fetch("/auth/session", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: request.signal });
        if (currentGeneration !== generation || stopped) return;
        if (!response.ok) { revoke(); return; }
        const session = await response.json() as Session;
        if (currentGeneration !== generation || stopped) return;
        if (session.operator?.role !== "owner" || !session.id || !session.operator.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) { revoke(); return; }
        const current = JSON.stringify([session.id, session.operator.id]);
        if (current !== identity) { editor.setOwner(true); identity = current; }
        // Base keeps an equivalent, unexpired grant mounted during renewal. Its
        // expiry timer remains authoritative even while either request is pending.
        await editor.refresh(loadConfig);
      } catch { if (currentGeneration === generation && !stopped) revoke(); }
      finally {
        if (controller === request) controller = undefined;
        pending = false;
        if (queued && !stopped) { queued = false; void refresh(); }
      }
    };
    const changed = () => { void refresh(); };
    const lost = () => { stopped = true; queued = false; revoke(); };
    window.addEventListener("dial:auth-lost", lost);
    window.addEventListener("focus", changed);
    const timer = setInterval(() => void refresh(), 20_000);
    void refresh();
    return () => { stopped = true; queued = false; revoke(); clearInterval(timer); editor.dispose(); window.removeEventListener("dial:auth-lost", lost); window.removeEventListener("focus", changed); };
  }, []);
  return null;
}
