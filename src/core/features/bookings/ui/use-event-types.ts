import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import type { EventTypeRecord } from "../../event-types";

/** The event types the bookings and report filters choose from. */
export function useEventTypes() {
  const initial = useWorkspaceRead<EventTypeRecord[]>("/api/app/event-types");
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[]>(initial ?? []);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.api.app["event-types"].$get({}).then(async (response) => {
      if (response.ok) setEventTypes(await response.json() as EventTypeRecord[]);
      else setError(await errorMessage(response));
    }).catch(() => setError("Event types could not be loaded."));
  }, []);
  return { eventTypes, error };
}
