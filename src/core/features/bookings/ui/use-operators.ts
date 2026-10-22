import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";

/** The workspace's operators, loaded only when a record names one, so its history and payments say who acted. */
export function useOperators(enabled: boolean) {
  const [operators, setOperators] = useState<Array<{ id: string; email: string }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app.operators.$get();
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json();
        if (active) setOperators(result.operators);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "Operator names could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [enabled]);
  return { operators, error };
}
