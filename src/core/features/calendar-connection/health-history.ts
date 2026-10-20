import { createId } from "../../shared/ids";
import type { CalendarConnectionStatus } from "./repository";

export type CalendarHealthChange = {
  id: string;
  eventType: "calendar.connection-health-changed.v1";
  fromState: CalendarConnectionStatus;
  toState: CalendarConnectionStatus;
  reason: string;
  occurredAt: string;
};

/** Execute immediately before the state write in the same D1 batch: no lost or duplicate transitions. */
export function healthChangeStatement(binding: D1Database, to: CalendarConnectionStatus, reason: string, at: string) {
  return binding.prepare(`INSERT INTO calendar_connection_health_changes
    (id, event_type, from_state, to_state, reason, occurred_at, created_at, updated_at)
    SELECT ?, 'calendar.connection-health-changed.v1',
      COALESCE((SELECT status FROM calendar_connections WHERE singleton_key='default'), 'disconnected'), ?, ?, ?, ?, ?
    WHERE COALESCE((SELECT status FROM calendar_connections WHERE singleton_key='default'), 'disconnected') <> ?`)
    .bind(createId(), to, reason, at, at, at, to);
}

export async function recentHealthChanges(binding: D1Database): Promise<CalendarHealthChange[]> {
  return (await binding.prepare(`SELECT id, event_type AS eventType, from_state AS fromState,
    to_state AS toState, reason, occurred_at AS occurredAt FROM calendar_connection_health_changes
    ORDER BY occurred_at DESC, id DESC LIMIT 10`).all<CalendarHealthChange>()).results;
}
