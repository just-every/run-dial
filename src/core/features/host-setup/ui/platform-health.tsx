import { useWorkspaceRead } from "../../../app/workspace-reads";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../../api/client";
import type { PlatformHealth } from "../../../platform/health";

type HealthState = { platform?: PlatformHealth & { checkedAt: string }; error: string };
const PlatformHealthContext = createContext<HealthState | undefined>(undefined);

/** Keep independent binding checks for the lifetime of the signed-in workspace. */
export function PlatformHealthProvider({ children }: { children: ReactNode }) {
  const platform = useWorkspaceRead<NonNullable<HealthState["platform"]>>("/api/app/platform-health");
  const [state, setState] = useState<HealthState>({ platform, error: "" });
  useEffect(() => {
    let active = true;
    const request = new AbortController();
    const stop = () => { active = false; request.abort(); };
    window.addEventListener("dial:auth-lost", stop);
    void api.api.app["platform-health"].$get(undefined, { init: { signal: request.signal } }).then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const platform = await response.json();
      if (active) setState({ platform, error: "" });
    }).catch((cause: unknown) => {
      if (active) setState({ error: cause instanceof Error ? cause.message : "Platform health could not be checked." });
    });
    return () => { stop(); window.removeEventListener("dial:auth-lost", stop); };
  }, []);
  return <PlatformHealthContext.Provider value={state}>{children}</PlatformHealthContext.Provider>;
}

export function usePlatformHealth() {
  const state = useContext(PlatformHealthContext);
  if (!state) throw new Error("Platform health requires a signed-in workspace.");
  return state;
}
