import { useWorkspaceRead } from "../../../app/workspace-reads";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import type { PlatformHealth } from "../../../platform/health";

type HealthState = { platform?: PlatformHealth & { checkedAt: string }; error: string };

/** Check the bindings only while their status is displayed. */
export function usePlatformHealth() {
  const platform = useWorkspaceRead<NonNullable<HealthState["platform"]>>("/api/app/platform-health");
  const [state, setState] = useState<HealthState & { source: typeof platform }>({ source: platform, platform, error: "" });
  useEffect(() => {
    const initial = platform;
    let active = true;
    const request = new AbortController();
    const stop = () => { active = false; request.abort(); };
    window.addEventListener("dial:auth-lost", stop);
    void api.api.app["platform-health"].$get(undefined, { init: { signal: request.signal } }).then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const platform = await response.json();
      if (active) setState({ source: initial, platform, error: "" });
    }).catch((cause: unknown) => {
      if (active) setState({ source: initial, error: cause instanceof Error ? cause.message : "Platform health could not be checked." });
    });
    return () => { stop(); window.removeEventListener("dial:auth-lost", stop); };
  }, [platform]);
  return state.source === platform ? state : { platform, error: "" };
}
