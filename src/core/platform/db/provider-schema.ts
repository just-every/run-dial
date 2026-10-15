import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const calendarConnections = sqliteTable("calendar_connections", {
  singletonKey: text("singleton_key").primaryKey(),
  provider: text("provider", { enum: ["google"] }).notNull(),
  status: text("status", { enum: ["disconnected", "healthy", "unhealthy"] }).notNull(),
  authorisedByOperatorId: text("authorised_by_operator_id"),
  accountEmail: text("account_email"),
  accessTokenCiphertext: text("access_token_ciphertext"),
  refreshTokenCiphertext: text("refresh_token_ciphertext"),
  accessTokenExpiresAt: text("access_token_expires_at"),
  syncCursor: text("sync_cursor"),
  channelId: text("channel_id"),
  channelResourceId: text("channel_resource_id"),
  channelExpiresAt: text("channel_expires_at"),
  lastCheckedAt: text("last_checked_at"),
  lastSuccessfulReadAt: text("last_successful_read_at"),
  unhealthyCode: text("unhealthy_code"),
  ...timestamps,
});

export const calendarConnectionCalendars = sqliteTable(
  "calendar_connection_calendars",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    purpose: text("purpose", { enum: ["destination", "conflict"] }).notNull(),
    conferenceCapable: integer("conference_capable", { mode: "boolean" }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_connection_calendar_purpose_unique").on(table.calendarId, table.purpose),
    index("calendar_connection_calendars_purpose_idx").on(table.purpose),
  ],
);

export const calendarPushChannels = sqliteTable(
  "calendar_push_channels",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    providerChannelId: text("provider_channel_id").notNull(),
    providerResourceId: text("provider_resource_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_push_channels_channel_unique").on(table.providerChannelId),
    uniqueIndex("calendar_push_channels_calendar_unique").on(table.calendarId),
    index("calendar_push_channels_expiry_idx").on(table.expiresAt),
  ],
);

export const providerConnectionHealth = sqliteTable("provider_connection_health", {
  provider: text("provider", { enum: ["google_calendar", "resend", "sendgrid", "rer", "development"] }).primaryKey(),
  status: text("status", { enum: ["healthy", "unhealthy"] }).notNull(),
  lastCheckedAt: text("last_checked_at"),
  unhealthyCode: text("unhealthy_code"),
  alertState: text("alert_state", { enum: ["healthy_announced", "unhealthy_announced", "unannounced"] }).notNull(),
  alertCycle: integer("alert_cycle").notNull(),
  ...timestamps,
});

export const calendarOAuthStates = sqliteTable(
  "calendar_oauth_states",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    operatorId: text("operator_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("calendar_oauth_states_expiry_idx").on(table.expiresAt, table.consumedAt)],
);

export const calendarBusyIntervals = sqliteTable(
  "calendar_busy_intervals",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    transparency: text("transparency", { enum: ["opaque", "transparent"] }).notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull(),
    observedAt: text("observed_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_busy_intervals_unique").on(table.calendarId, table.startsAt, table.endsAt),
    index("calendar_busy_intervals_lookup_idx").on(table.calendarId, table.startsAt, table.endsAt, table.observedAt),
  ],
);

export const calendarBusyReadWindows = sqliteTable(
  "calendar_busy_read_windows",
  {
    id: text("id").primaryKey(),
    calendarId: text("calendar_id").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    observedAt: text("observed_at").notNull(),
    ...timestamps,
  },
  (table) => [index("calendar_busy_read_windows_coverage_idx").on(table.calendarId, table.startsAt, table.endsAt, table.observedAt)],
);

export const deliveryOutbox = sqliteTable(
  "delivery_outbox",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["calendar_upsert", "calendar_cancel", "mail_send", "reminder"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    bookingId: text("booking_id"),
    occurrenceId: text("occurrence_id"),
    requestId: text("request_id"),
    payloadJson: text("payload_json").notNull(),
    state: text("state", { enum: ["pending", "processing", "succeeded", "failed"] }).notNull(),
    attempts: integer("attempts").notNull(),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastErrorCode: text("last_error_code"),
    succeededAt: text("succeeded_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("delivery_outbox_idempotency_key_unique").on(table.idempotencyKey),
    index("delivery_outbox_due_idx").on(table.state, table.nextAttemptAt, table.createdAt),
    index("delivery_outbox_booking_idx").on(table.bookingId, table.occurrenceId, table.state),
    index("delivery_outbox_request_idx").on(table.requestId, table.state),
  ],
);

export const deliveryAttempts = sqliteTable(
  "delivery_attempts",
  {
    id: text("id").primaryKey(),
    outboxId: text("outbox_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome", { enum: ["succeeded", "retrying", "failed"] }).notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    attemptedAt: text("attempted_at").notNull(),
  },
  (table) => [uniqueIndex("delivery_attempts_outbox_attempt_unique").on(table.outboxId, table.attemptNumber)],
);

export const providerWebhookEvents = sqliteTable(
  "provider_webhook_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider", { enum: ["google_calendar", "resend", "sendgrid"] }).notNull(),
    providerEventId: text("provider_event_id").notNull(),
    occurredAt: text("occurred_at"),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
    state: text("state", { enum: ["received", "processed", "ignored"] }).notNull(),
    payloadHash: text("payload_hash").notNull(),
  },
  (table) => [uniqueIndex("provider_webhook_events_unique").on(table.provider, table.providerEventId)],
);

export const operatorDeliveryPreferences = sqliteTable("operator_delivery_preferences", {
  operatorId: text("operator_id").primaryKey(),
  bookingMailMuted: integer("booking_mail_muted", { mode: "boolean" }).notNull(),
  ...timestamps,
});
