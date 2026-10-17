import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const eventScheduleBindings = sqliteTable("event_schedule_bindings", {
  eventTypeId: text("event_type_id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
