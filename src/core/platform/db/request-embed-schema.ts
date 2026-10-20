import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { eventTypes, operators } from "./schema";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const availabilityRequestReviewNonces = sqliteTable(
  "availability_request_review_nonces",
  {
    id: text("id").primaryKey(),
    eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
    inviteeEmail: text("invitee_email"),
    nonceHash: text("nonce_hash").notNull(),
    compositionHash: text("composition_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    requestId: text("request_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("availability_request_review_nonces_hash_unique").on(table.nonceHash),
    index("availability_request_review_nonces_expiry_idx").on(table.expiresAt, table.consumedAt),
  ],
);

export const availabilityRequests = sqliteTable(
  "availability_requests",
  {
    id: text("id").primaryKey(),
    eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "restrict" }),
    eventTitle: text("event_title").notNull(),
    inviteeName: text("invitee_name").notNull(),
    inviteeEmail: text("invitee_email").notNull(),
    inviteeTimezone: text("invitee_timezone").notNull(),
    browserTimezone: text("browser_timezone"),
    note: text("note"),
    state: text("state", { enum: ["submitted", "handled", "closed"] }).notNull(),
      nonceHash: text("nonce_hash").notNull(),
    compositionHash: text("composition_hash").notNull(),
    bookingId: text("booking_id"),
    submittedAt: text("submitted_at").notNull(),
    handledAt: text("handled_at"),
    closedAt: text("closed_at"),
    stateChangedByOperatorId: text("state_changed_by_operator_id").references(() => operators.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("availability_requests_nonce_hash_unique").on(table.nonceHash),
    index("availability_requests_state_submitted_idx").on(table.state, table.submittedAt),
    index("availability_requests_event_type_idx").on(table.eventTypeId, table.submittedAt),
  ],
);

export const availabilityRequestWindows = sqliteTable(
  "availability_request_windows",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().references(() => availabilityRequests.id, { onDelete: "cascade" }),
    requestedDate: text("requested_date").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("availability_request_windows_position_unique").on(table.requestId, table.position),
    index("availability_request_windows_request_idx").on(table.requestId, table.requestedDate, table.startMinute),
  ],
);

export const embedAllowedOrigins = sqliteTable("embed_allowed_origins", {
  origin: text("origin").primaryKey(),
  ...timestamps,
});
