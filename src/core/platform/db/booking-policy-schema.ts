import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const eventBookingPolicies = sqliteTable("event_booking_policies", {
  eventTypeId: text("event_type_id").primaryKey(),
  lockedTimezone: text("locked_timezone"),
  rescheduleCutoffMinutes: integer("reschedule_cutoff_minutes"),
  cancellationCutoffMinutes: integer("cancellation_cutoff_minutes"),
  maxInviteeReschedules: integer("reschedule_cap"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
