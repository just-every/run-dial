import { useWorkspaceRead } from "../../../app/workspace-reads";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { api, errorMessage } from "../../../api/client";
import type { HostSetupOverview } from "../steps";

export const hostSetupChanged = () => window.dispatchEvent(new Event("dial-host-setup-changed"));

export function useHostSetup() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const initial = useWorkspaceRead<HostSetupOverview>("/api/app/host-setup");
  const [state, setState] = useState<HostSetupOverview | undefined>(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let epoch = 0;
    const load = async () => {
      const current = ++epoch;
      try {
        const response = await api.api.app["host-setup"].$get();
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json();
        if (active && epoch === current) { setState(result); setError(""); }
      } catch (cause) { if (active && epoch === current) { setState(undefined); setError(cause instanceof Error ? cause.message : "Setup could not be loaded."); } }
    };
    void load();
    window.addEventListener("dial-host-setup-changed", load);
    return () => { active = false; window.removeEventListener("dial-host-setup-changed", load); };
  }, [pathname]);
  return { state, error };
}
