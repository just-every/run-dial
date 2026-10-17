import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const operators = sqliteTable("operators", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull().unique(),
  removedAt: text("removed_at"),
  accessGeneration: integer("access_generation").notNull().default(0),
  ...timestamps,
});

export const hostProfiles = sqliteTable("host_profiles", {
  id: text("id").primaryKey(),
  singletonKey: text("singleton_key").notNull().unique(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  biography: text("biography").notNull(),
  avatarKey: text("avatar_key"),
  avatarContentType: text("avatar_content_type"),
  timezone: text("timezone").notNull(),
  ...timestamps,
});

export const avatarObjectDeletions = sqliteTable("avatar_object_deletions", {
  id: text("id").primaryKey(),
  objectKey: text("object_key").notNull().unique(),
  ...timestamps,
});

export const profileFocusAreas = sqliteTable("profile_focus_areas", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  label: text("label").notNull(),
  position: integer("position").notNull(),
  ...timestamps,
});

export const socialProofEntries = sqliteTable("social_proof_entries", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  quote: text("quote").notNull(),
  attribution: text("attribution").notNull(),
  position: integer("position").notNull(),
  ...timestamps,
});

export const eventTypes = sqliteTable("event_types", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["draft", "published", "disabled"] }).notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  color: text("color").notNull(),
  locationType: text("location_type").notNull(),
  locationLabel: text("location_label").notNull(),
  locationValue: text("location_value").notNull(),
  listed: integer("listed", { mode: "boolean" }).notNull(),
  requestOnly: integer("request_only", { mode: "boolean" }).notNull().default(false),
  alternativeRequestsEnabled: integer("alternative_requests_enabled", { mode: "boolean" }).notNull(),
  slotIncrementMinutes: integer("slot_increment_minutes").notNull(),
  minimumNoticeMinutes: integer("minimum_notice_minutes").notNull(),
  bookingHorizonDays: integer("booking_horizon_days").notNull(),
  bookingHorizonMode: text("booking_horizon_mode", { enum: ["calendar_days", "weekdays", "fixed_range", "indefinite"] }).notNull().default("calendar_days"),
  bookingStartDate: text("booking_start_date"),
  bookingEndDate: text("booking_end_date"),
  beforeBufferMinutes: integer("before_buffer_minutes").notNull(),
  afterBufferMinutes: integer("after_buffer_minutes").notNull(),
  hostDayBookingLimit: integer("host_day_booking_limit"),
  ...timestamps,
});

export const eventQuestions = sqliteTable("event_questions", {
  id: text("id").primaryKey(),
  eventTypeId: text("event_type_id").notNull(),
  publicKey: text("public_key"),
  position: integer("position").notNull(),
  kind: text("kind", { enum: ["text", "textarea", "phone", "dropdown", "single_choice", "multiple_choice", "checkbox"] }).notNull(),
  label: text("label").notNull(),
  required: integer("required", { mode: "boolean" }).notNull(),
  optionsJson: text("options_json").notNull(),
  ...timestamps,
});

export const recurringAvailabilityWindows = sqliteTable("recurring_availability_windows", {
  id: text("id").primaryKey(),
  eventTypeId: text("event_type_id").notNull(),
  weekday: integer("weekday").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  ...timestamps,
});

export const availabilityDateOverrides = sqliteTable(
  "availability_date_overrides",
  {
    id: text("id").primaryKey(),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    hostDate: text("host_date").notNull(),
    mode: text("mode", { enum: ["open", "closed"] }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("availability_date_overrides_event_date_unique").on(table.eventTypeId, table.hostDate),
    index("availability_date_overrides_event_date_idx").on(table.eventTypeId, table.hostDate),
  ],
);

export const availabilityDateOverrideWindows = sqliteTable("availability_date_override_windows", {
  id: text("id").primaryKey(),
  overrideId: text("override_id")
    .notNull()
    .references(() => availabilityDateOverrides.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  ...timestamps,
});

export const operatorSetupIdentity = sqliteTable("operator_setup_identity", {
  singletonKey: text("singleton_key").primaryKey(),
  operatorId: text("operator_id").notNull(),
  createdAt: text("created_at").notNull(),
  onboardingCompletedAt: text("onboarding_completed_at"),
});
