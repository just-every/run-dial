import manifest from "../../../../seed.json";

export const eventTypeCapacity = {
  event_types_per_host: manifest.limits.maxEventTypesPerHost,
  event_types_per_workspace: manifest.limits.maxEventTypes,
};

export class EventCapacityReached extends Error {
  readonly code = "workspace_capacity_reached";
  constructor(readonly limit: keyof typeof eventTypeCapacity, readonly value: number, readonly currentUse: number) {
    super(`The ${limit} limit of ${value} has been reached.`);
  }
}

// The current install has one shared host. Every event belongs to that host,
// regardless of lifecycle state; there is no published-only count or cleanup.
export const eventTypeUseSql = "SELECT count(*) AS currentUse FROM event_types";
export const eventCapacityGuard = `(SELECT count(*) FROM event_types) < ? AND (SELECT count(*) FROM event_types) < ?`;
export const eventCapacityParams = [eventTypeCapacity.event_types_per_host, eventTypeCapacity.event_types_per_workspace];

/** Host takes precedence when both limits are full. Use the transaction's count. */
export function eventCapacityRefusal(currentUse: number) {
  for (const limit of ["event_types_per_host", "event_types_per_workspace"] as const) {
    if (currentUse >= eventTypeCapacity[limit]) return new EventCapacityReached(limit, eventTypeCapacity[limit], currentUse);
  }
  throw new Error("Event admission failed without a full capacity limit");
}
