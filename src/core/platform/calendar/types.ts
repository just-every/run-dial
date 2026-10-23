export type ProviderFailureCode =
  | "push_channel_unrenewable"
  | "meeting_creation_failed"
  | "superseded_occurrence"
  | "operator_removed"
  | "operator_mail_outcome_unknown"
  | "operator_notification_coordination_failed"
  | "missing_configuration"
  | "reauthorization_required"
  | "permanent_delivery_failure"
  | "mail_outcome_unknown"
  | "unauthorized"
  | "forbidden"
  | "quota_exhausted"
  | "provider_write_conflict"
  | "provider_timeout"
  | "provider_unavailable"
  | "invalid_sync_cursor"
  | "invalid_provider_response"
  | "invalid_delivery_payload"
  | "internal_error";

export class ProviderFailure extends Error {
  constructor(
    readonly code: ProviderFailureCode,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export type CalendarCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type GoogleCalendarDescriptor = {
  id: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner" | "none";
  primary: boolean;
  conferenceCapable: boolean;
};

export type BusyInterval = {
  calendarId: string;
  startsAt: string;
  endsAt: string;
  transparency: "opaque" | "transparent";
  deleted: boolean;
};

export type BusyRead = {
  intervals: BusyInterval[];
  observedAt: string;
};

export type ManagedCalendarEvent = {
  transparency?: "opaque" | "transparent";
  idempotencyKey: string;
  bookingId: string;
  occurrenceId: string;
  icalUid: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  inviteeEmail: string;
  guestEmails?: string[];
  requestGoogleMeet: boolean;
  requestMicrosoftTeams?: boolean;
};

export type ManagedCalendarEventResult = {
  providerEventId: string;
  providerUpdatedAt: string;
  conferenceUrl?: string;
  conferenceState: "pending" | "ready" | "not_requested" | "failed";
};

export type CalendarPushChannel = {
  calendarId: string;
  providerChannelId: string;
  providerResourceId: string;
  expiresAt: string;
};

export type ManagedCalendarChange =
  | { bookingId?: string; occurrenceId?: string; providerEventId: string; /** Google may omit this on cancelled entries. */ updatedAt?: string; kind: "deleted" }
  | { bookingId: string; occurrenceId: string; providerEventId: string; updatedAt: string; kind: "changed"; startAt: string; endAt: string; location?: string };

export type ManagedCalendarSync = {
  changes: ManagedCalendarChange[];
  syncCursor: string;
};

export type ManagedEventInspection =
  | { kind: "present"; event: Extract<ManagedCalendarChange, { kind: "changed" }> }
  | { kind: "deleted"; providerEventId: string }
  | { kind: "unresolved"; code: "event_missing" | "identity_missing" | "ambiguous_events" };

/** calendar.provider.v2 adds mandatory fresh managed-event inspection to v1. */
export interface CalendarAdapter {
  authorizationUrl(redirectUri: string, state: string): string;
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<CalendarCredentials>;
  refreshAccessToken(refreshToken: string): Promise<CalendarCredentials>;
  listCalendars(accessToken: string): Promise<GoogleCalendarDescriptor[]>;
  checkDestination(accessToken: string, calendarId: string): Promise<GoogleCalendarDescriptor>;
  readBusy(accessToken: string, input: { calendarIds: string[]; startsAt: string; endsAt: string; timeZone: string }): Promise<BusyRead>;
  upsertManagedEvent(accessToken: string, calendarId: string, event: ManagedCalendarEvent): Promise<ManagedCalendarEventResult>;
  inspectManagedEvent(accessToken: string, calendarId: string, input: { bookingId: string; providerEventId: string }): Promise<ManagedEventInspection>;
  cancelManagedEvent(accessToken: string, calendarId: string, bookingId: string): Promise<void>;
  syncManagedEvents(accessToken: string, calendarId: string, syncCursor?: string): Promise<ManagedCalendarSync>;
  watchCalendars(accessToken: string, input: { calendarIds: string[]; callbackUrl: string; channelToken: string }): Promise<CalendarPushChannel[]>;
  stopWatch(accessToken: string, input: { providerChannelId: string; providerResourceId: string }): Promise<void>;
}
