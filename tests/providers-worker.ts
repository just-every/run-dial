import { CalendarConnectionRepository, CalendarConnectionService } from "../src/core/features/calendar-connection";
import { BookingsRepository, ManageCapabilityService } from "../src/core/features/bookings";
import { bookingConfirmationMail, DeliveryRepository, ProviderDeliveryService } from "../src/core/features/delivery";
import { createOpaqueToken, hashToken } from "../src/core/platform/auth/tokens";
import type { CalendarAdapter, CalendarCredentials, CalendarPushChannel, GoogleCalendarDescriptor, ManagedCalendarEvent, ManagedCalendarEventResult } from "../src/core/platform/calendar";
import type { MailMessage, MailSender } from "../src/core/platform/mail";
import type { RuntimeEnvironment } from "../src/core/shared/runtime-env";

type Bindings = { DB: D1Database };

const runtime: RuntimeEnvironment = {
  ENVIRONMENT: "development",
  APP_URL: "http://dial.test",
  SESSION_SECRET: "provider-runtime-test-secret-that-is-at-least-thirty-two-bytes",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  CALENDAR_WEBHOOK_SECRET: "calendar-webhook-secret-that-is-at-least-thirty-two-bytes",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "no-reply@dial.test",
  RESEND_WEBHOOK_SECRET: "whsec_test",
};

const session = { id: "operator-provider-test", email: "operator@dial.test", sessionId: "session-provider-test", expiresAt: "2031-01-01T00:00:00.000Z" };

class FixtureCalendar implements CalendarAdapter {
  busyReads = 0;
  watches = 0;
  stops = 0;
  managedEvents: ManagedCalendarEvent[] = [];
  conferenceState: "pending" | "ready" = "ready";

  authorizationUrl(_redirectUri: string, state: string) {
    return `https://accounts.example.test/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeAuthorizationCode(): Promise<CalendarCredentials> {
    return { accessToken: "access-token-for-runtime-test", refreshToken: "refresh-token-for-runtime-test", expiresAt: "2030-01-01T00:00:00.000Z" };
  }

  async refreshAccessToken(): Promise<CalendarCredentials> {
    return { accessToken: "refreshed-access-token", refreshToken: "refresh-token-for-runtime-test", expiresAt: "2030-01-01T00:00:00.000Z" };
  }

  async listCalendars(): Promise<GoogleCalendarDescriptor[]> {
    return [
      { id: "destination", accessRole: "writer", primary: true, conferenceCapable: true },
      { id: "conflicts", accessRole: "reader", primary: false, conferenceCapable: false },
    ];
  }

  async checkDestination(): Promise<GoogleCalendarDescriptor> {
    return { id: "destination", accessRole: "writer", primary: true, conferenceCapable: true };
  }

  async readBusy() {
    this.busyReads += 1;
    return { intervals: [], observedAt: new Date().toISOString() };
  }

  async upsertManagedEvent(_accessToken: string, _calendarId: string, event: ManagedCalendarEvent): Promise<ManagedCalendarEventResult> {
    this.managedEvents.push(event);
    return this.conferenceState === "pending"
      ? { providerEventId: "google-event-provider-test", providerUpdatedAt: "2030-06-03T10:00:00.000Z", conferenceState: "pending" }
      : { providerEventId: "google-event-provider-test", providerUpdatedAt: "2030-06-03T10:00:00.000Z", conferenceState: "ready", conferenceUrl: "https://meet.google.com/provider-test" };
  }

  async cancelManagedEvent() {}

  async inspectManagedEvent() { return { kind: "unresolved" as const, code: "event_missing" as const }; }

  async syncManagedEvents() {
    return { changes: [], syncCursor: "fixture-sync-cursor" };
  }

  async watchCalendars(_accessToken: string, input: { calendarIds: string[] }): Promise<CalendarPushChannel[]> {
    this.watches += 1;
    return input.calendarIds.map((calendarId) => ({
      calendarId,
      providerChannelId: `provider-channel-${this.watches}-${calendarId}`,
      providerResourceId: `provider-resource-${this.watches}-${calendarId}`,
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString(),
    }));
  }

  async stopWatch() {
    this.stops += 1;
  }
}

class FixtureMail implements MailSender {
  sent: MailMessage[] = [];

  async checkConnection() {
    return { checkedAt: new Date().toISOString() };
  }

  async send(message: MailMessage) {
    this.sent.push(message);
    return { providerMessageId: `resend-${this.sent.length}` };
  }
}

const calendarAdapter = new FixtureCalendar();
const mail = new FixtureMail();

export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url);
    const services = servicesFor(env.DB);
    if (url.pathname === "/oauth") return Response.json(await oauthCycle(services.calendar, env.DB));
    if (url.pathname === "/cache") return Response.json(await cacheCycle(services.calendar, services.calendarRepository));
    if (url.pathname === "/channels") return Response.json(await channelCycle(services.calendar, env.DB));
    if (url.pathname === "/delivery") return Response.json(await deliveryCycle(services.delivery, env.DB));
    if (url.pathname === "/stale-calendar-finish") return Response.json(await staleCalendarFinishCycle(services.calendar, services.calendarRepository, env.DB));
    if (url.pathname === "/rotated-capability-finish") return Response.json(await rotatedCapabilityFinishCycle(services.calendar, services.calendarRepository, env.DB));
    if (url.pathname === "/pending-meet") return Response.json(await pendingMeetCycle(services.calendar, services.calendarRepository, services.delivery, env.DB));
    return new Response("Not found", { status: 404 });
  },
};

function servicesFor(binding: D1Database) {
  const calendarRepository = new CalendarConnectionRepository(binding);
  const calendar = new CalendarConnectionService(calendarRepository, runtime, calendarAdapter);
  return {
    calendarRepository,
    calendar,
    delivery: new ProviderDeliveryService(new DeliveryRepository(binding), calendar, mail, runtime.RESEND_WEBHOOK_SECRET, runtime.SESSION_SECRET),
  };
}

async function oauthCycle(calendar: CalendarConnectionService, binding: D1Database) {
  const start = await calendar.beginAuthorization(session);
  if (!start) throw new Error("Fixture has calendar configuration");
  const state = new URL(start).searchParams.get("state");
  if (!state) throw new Error("Calendar start did not include state");
  const connected = await calendar.completeAuthorization({ state, code: "provider-code", session });
  const replay = await calendar.completeAuthorization({ state, code: "provider-code", session });
  const connection = await binding.prepare("SELECT status, access_token_ciphertext AS accessTokenCiphertext FROM calendar_connections WHERE singleton_key = 'default'").first<{ status: string; accessTokenCiphertext: string }>();
  return { connected: connected.kind, replay: replay.kind, status: connection?.status, storesPlainToken: connection?.accessTokenCiphertext.includes("access-token-for-runtime-test") ?? false };
}

async function ensureConnection(calendar: CalendarConnectionService, repository: CalendarConnectionRepository) {
  const current = await repository.get();
  if (!current) {
    const start = await calendar.beginAuthorization(session);
    if (!start) throw new Error("Fixture has calendar configuration");
    const state = new URL(start).searchParams.get("state");
    if (!state) throw new Error("Missing fixture state");
    const connected = await calendar.completeAuthorization({ state, code: "provider-code", session });
    if (connected.kind !== "connected") throw new Error("Fixture OAuth did not connect");
  }
  const selected = await calendar.selectCalendars({ destinationCalendarId: "destination", conflictCalendarIds: ["conflicts"] });
  if (selected.kind !== "saved") throw new Error("Fixture selection did not save");
  const health = await calendar.checkConnection();
  if (health.kind !== "healthy") throw new Error("Fixture connection did not become healthy");
}

async function cacheCycle(calendar: CalendarConnectionService, repository: CalendarConnectionRepository) {
  await ensureConnection(calendar, repository);
  const range = { startAt: "2030-06-03T10:00:00.000Z", endAt: "2030-06-03T11:00:00.000Z" };
  const before = calendarAdapter.busyReads;
  await calendar.readBusy({ ...range, freshness: "fresh" });
  const afterFresh = calendarAdapter.busyReads;
  await calendar.readBusy({ ...range, freshness: "cached" });
  const afterCached = calendarAdapter.busyReads;
  await repository.markUnhealthy("provider_timeout");
  await calendar.readBusy({ ...range, freshness: "cached" });
  const afterRecovery = calendarAdapter.busyReads;
  const channel = (await repository.listPushChannels()).find((entry) => entry.calendarId === "conflicts");
  if (!channel) throw new Error("Fixture lacks conflict watch channel");
  const callback = await calendar.receiveGoogleWebhook(new Headers({
    "x-goog-channel-id": channel.providerChannelId,
    "x-goog-resource-id": channel.providerResourceId,
    "x-goog-message-number": "100",
    "x-goog-channel-token": runtime.CALENDAR_WEBHOOK_SECRET,
  }), async () => ({ kind: "admitted" }));
  await calendar.readBusy({ ...range, freshness: "cached" });
  return {
    freshReads: afterFresh - before,
    cachedReads: afterCached - afterFresh,
    recoveryReads: afterRecovery - afterCached,
    webhook: callback.kind,
    callbackFreshReads: calendarAdapter.busyReads - afterRecovery,
  };
}

async function channelCycle(calendar: CalendarConnectionService, binding: D1Database) {
  await ensureConnection(calendar, new CalendarConnectionRepository(binding));
  const current = await calendar.renewExpiringPushChannels();
  const watchesBeforeExpiry = calendarAdapter.watches;
  await binding.prepare("UPDATE calendar_push_channels SET expires_at = ?").bind(new Date(Date.now() + 60_000).toISOString()).run();
  const renewed = await calendar.renewExpiringPushChannels();
  return { current: current.kind, renewed: renewed.kind, watchesAdded: calendarAdapter.watches - watchesBeforeExpiry, stopped: calendarAdapter.stops };
}

async function deliveryCycle(delivery: ProviderDeliveryService, binding: D1Database) {
  const timestamp = new Date().toISOString();
  const { manageUrl } = await seedCalendarCommand(binding, "provider-booking", "provider-occurrence", "provider-calendar-command", timestamp);
  await delivery.processDue(1);
  const booking = await binding.prepare("SELECT calendar_state AS calendarState, meeting_state AS meetingState, meeting_url AS meetingUrl FROM bookings WHERE id = 'provider-booking'").first<{ calendarState: string; meetingState: string; meetingUrl: string }>();
  const link = await binding.prepare("SELECT state, payload_json AS payloadJson FROM delivery_outbox WHERE idempotency_key = 'booking:provider-booking:occurrence:provider-occurrence:link-ready'").first<{ state: string; payloadJson: string }>();
  await delivery.processDue(1);
  const payload = link ? JSON.parse(link.payloadJson) as Record<string, unknown> & { manageUrl?: string; text?: string; html?: string } : undefined;
  const selectedToken = typeof payload?.manageUrl === "string" ? new URL(payload.manageUrl).pathname.split("/").at(-1) : undefined;
  const selectedTokenHash = selectedToken ? await hashToken(selectedToken, runtime.SESSION_SECRET) : undefined;
  const selectedCapabilityActive = selectedTokenHash ? Boolean(await binding.prepare("SELECT 1 FROM booking_manage_tokens WHERE booking_id = 'provider-booking' AND token_hash = ? AND expires_at > ? AND rotated_at IS NULL AND invalidated_at IS NULL").bind(selectedTokenHash, timestamp).first()) : false;
  const safePayload = payload ? { ...payload } : undefined;
  if (safePayload) {
    delete safePayload.manageUrl;
    for (const key of ["text", "html"] as const) {
      if (safePayload[key] && selectedToken) safePayload[key] = safePayload[key]!.replaceAll(selectedToken, "[redacted]");
    }
  }
  return {
    booking,
    link: link && safePayload ? { state: link.state, payload: safePayload } : undefined,
    selectedCurrentCapability: payload?.manageUrl === manageUrl,
    selectedCapabilityActive,
    managedEventIcalUid: calendarAdapter.managedEvents.at(-1)?.icalUid,
    sent: mail.sent.length,
  };
}

async function staleCalendarFinishCycle(calendar: CalendarConnectionService, calendarRepository: CalendarConnectionRepository, binding: D1Database) {
  await ensureConnection(calendar, calendarRepository);
  const timestamp = new Date().toISOString();
  await seedCalendarCommand(binding, "race-booking", "race-old-occurrence", "race-calendar-command", timestamp);
  const interleaving = afterCurrentMailSnapshot(binding, async () => {
    await binding.batch([
      binding.prepare("UPDATE booking_occurrences SET is_current = 0, state = 'rescheduled', closed_at = ? WHERE id = 'race-old-occurrence'").bind(timestamp),
      binding.prepare("INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) VALUES ('race-current-occurrence', 'race-booking', 2, '2030-06-04T10:00:00.000Z', '2030-06-04T10:30:00.000Z', '2030-06-04T10:00:00.000Z', '2030-06-04T10:30:00.000Z', '2030-06-04', 'current', 1, ?)").bind(timestamp),
      binding.prepare("UPDATE bookings SET state = 'rescheduled', current_occurrence_id = 'race-current-occurrence', calendar_state = 'pending', updated_at = ? WHERE id = 'race-booking'").bind(timestamp),
    ]);
  });
  const delivery = new ProviderDeliveryService(new DeliveryRepository(interleaving.binding), calendar, mail, runtime.RESEND_WEBHOOK_SECRET, runtime.SESSION_SECRET);
  const callsBefore = calendarAdapter.managedEvents.length;
  const first = await delivery.process({ outboxId: "race-calendar-command" }, new Date(timestamp));
  const second = await delivery.process({ outboxId: "race-calendar-command" }, new Date(timestamp));
  const command = await binding.prepare("SELECT state, attempts, last_error_code AS lastErrorCode FROM delivery_outbox WHERE id = 'race-calendar-command'").first<{ state: string; attempts: number; lastErrorCode: string | null }>();
  const attempt = await binding.prepare("SELECT outcome, error_code AS errorCode FROM delivery_attempts WHERE outbox_id = 'race-calendar-command' ORDER BY attempt_number DESC LIMIT 1").first<{ outcome: string; errorCode: string | null }>();
  const booking = await binding.prepare("SELECT calendar_state AS calendarState, meeting_state AS meetingState FROM bookings WHERE id = 'race-booking'").first<{ calendarState: string; meetingState: string }>();
  const linkReady = await binding.prepare("SELECT count(*) AS count FROM delivery_outbox WHERE booking_id = 'race-booking' AND kind = 'mail_send' AND idempotency_key LIKE '%:link-ready'").first<{ count: number }>();
  return { interleavingOccurred: interleaving.didRun(), first, second, providerCalls: calendarAdapter.managedEvents.length - callsBefore, command, attempt, booking, linkReadyCount: linkReady?.count ?? 0 };
}

async function rotatedCapabilityFinishCycle(calendar: CalendarConnectionService, calendarRepository: CalendarConnectionRepository, binding: D1Database) {
  await ensureConnection(calendar, calendarRepository);
  const timestamp = new Date().toISOString();
  const { manageUrl: revokedManageUrl } = await seedCalendarCommand(binding, "rotate-race-booking", "rotate-race-occurrence", "rotate-race-calendar-command", timestamp);
  let rotatedManageUrl = "";
  const interleaving = afterCurrentMailSnapshot(binding, async () => {
    const repository = new BookingsRepository(binding);
    const booking = await repository.getById("rotate-race-booking");
    if (!booking) throw new Error("Capability-rotation fixture booking is missing");
    const result = await new ManageCapabilityService(repository, runtime).rotate(booking);
    if (result.kind !== "rotated") throw new Error("Capability-rotation fixture did not rotate its active manage token");
    rotatedManageUrl = result.manageUrl;
  });
  const delivery = new ProviderDeliveryService(new DeliveryRepository(interleaving.binding), calendar, mail, runtime.RESEND_WEBHOOK_SECRET, runtime.SESSION_SECRET);
  const callsBefore = calendarAdapter.managedEvents.length;
  const first = await delivery.process({ outboxId: "rotate-race-calendar-command" }, new Date(timestamp));
  const second = await delivery.process({ outboxId: "rotate-race-calendar-command" }, new Date(timestamp));
  const command = await binding.prepare("SELECT state, attempts, last_error_code AS lastErrorCode FROM delivery_outbox WHERE id = 'rotate-race-calendar-command'").first<{ state: string; attempts: number; lastErrorCode: string | null }>();
  const booking = await binding.prepare("SELECT calendar_state AS calendarState, meeting_state AS meetingState FROM bookings WHERE id = 'rotate-race-booking'").first<{ calendarState: string; meetingState: string }>();
  const linkReady = await binding.prepare("SELECT id, state, payload_json AS payloadJson FROM delivery_outbox WHERE booking_id = 'rotate-race-booking' AND kind = 'mail_send' AND idempotency_key LIKE '%:link-ready'").first<{ id: string; state: string; payloadJson: string }>();
  const currentCapability = await binding.prepare("SELECT json_extract(payload_json, '$.manageUrl') AS manageUrl FROM delivery_outbox WHERE idempotency_key = 'booking:rotate-race-booking:occurrence:rotate-race-occurrence:mail:invitee:invitee@dial.test'").first<{ manageUrl: string }>();
  const selectedToken = rotatedManageUrl ? new URL(rotatedManageUrl).pathname.split("/").at(-1) : undefined;
  const activeTokenHash = selectedToken ? await hashToken(selectedToken, runtime.SESSION_SECRET) : undefined;
  const activeCapability = activeTokenHash ? Boolean(await binding.prepare("SELECT 1 FROM booking_manage_tokens WHERE booking_id = 'rotate-race-booking' AND token_hash = ? AND rotated_at IS NULL AND invalidated_at IS NULL AND expires_at > ?").bind(activeTokenHash, timestamp).first()) : false;
  const queuedMail = linkReady ? JSON.parse(linkReady.payloadJson) as Record<string, unknown> & { text?: string; html?: string } : undefined;
  const delivered = linkReady ? await delivery.process({ outboxId: linkReady.id }) : "failed";
  const sent = mail.sent.at(-1);
  const sentText = sent?.text ?? "";
  const sentHtml = sent?.html ?? "";
  const frozenLink = linkReady ? await binding.prepare("SELECT state, payload_json AS payloadJson FROM delivery_outbox WHERE id = ?").bind(linkReady.id).first<{ state: string; payloadJson: string }>() : undefined;
  const frozenPayload = frozenLink ? JSON.parse(frozenLink.payloadJson) as Record<string, unknown> & { manageUrl?: string; text?: string; html?: string; wireMail?: { text?: string; html?: string } } : undefined;
  return {
    interleavingOccurred: interleaving.didRun(),
    currentCapabilityUpdated: currentCapability?.manageUrl === rotatedManageUrl,
    activeCapability,
    first,
    second,
    providerCalls: calendarAdapter.managedEvents.length - callsBefore,
    command,
    booking,
    linkReadyCount: linkReady ? 1 : 0,
    linkReadyState: frozenLink?.state,
    linkReadyQueuedOldCapability: queuedMail?.manageUrl === revokedManageUrl,
    linkReadyDelivery: delivered,
    linkReadySentCurrentCapability: Boolean(rotatedManageUrl && sentText.includes(rotatedManageUrl) && sentHtml.includes(rotatedManageUrl)),
    linkReadySentNoRevokedCapability: Boolean(!sentText.includes(revokedManageUrl) && !sentHtml.includes(revokedManageUrl)),
    linkReadyFrozenCapability: frozenPayload?.manageUrl === rotatedManageUrl,
    linkReadyFrozenWireMatchesSend: Boolean(frozenPayload?.wireMail && JSON.stringify(frozenPayload.wireMail) === JSON.stringify(sent)),
  };
}

function afterCurrentMailSnapshot(binding: D1Database, after: () => Promise<void>) {
  let didRun = false;
  const intercept = (prepared: D1PreparedStatement) => new Proxy(prepared, {
    get(statement, method) {
      if (method === "bind") return (...values: unknown[]) => intercept(statement.bind(...values));
      if (method === "first") return async () => {
        const result = await statement.first();
        if (!didRun) {
          didRun = true;
          await after();
        }
        return result;
      };
      const value = Reflect.get(statement, method, statement) as unknown;
      return typeof value === "function" ? value.bind(statement) : value;
    },
  }) as D1PreparedStatement;
  const interleaved = new Proxy(binding, {
    get(target, property) {
      if (property === "prepare") return (query: string) => {
        const statement = target.prepare(query);
        if (!query.includes("AS manageUrl") || !query.includes("LEFT JOIN booking_occurrences")) return statement;
        return intercept(statement);
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
  return { binding: interleaved, didRun: () => didRun };
}

async function pendingMeetCycle(calendar: CalendarConnectionService, repository: CalendarConnectionRepository, delivery: ProviderDeliveryService, binding: D1Database) {
  await ensureConnection(calendar, repository);
  const timestamp = new Date().toISOString();
  await seedCalendarCommand(binding, "pending-booking", "pending-occurrence", "pending-calendar-command", timestamp);
  calendarAdapter.conferenceState = "pending";
  await delivery.processDue(1);
  const pending = await binding.prepare("SELECT id, state, payload_json AS payloadJson FROM delivery_outbox WHERE idempotency_key = 'booking:pending-booking:occurrence:pending-occurrence:conference-poll:1'").first<{ id: string; state: string; payloadJson: string }>();
  if (!pending) throw new Error("Pending Meet did not schedule a durable poll");
  await binding.prepare("UPDATE delivery_outbox SET next_attempt_at = ? WHERE id = ?").bind(new Date().toISOString(), pending.id).run();
  calendarAdapter.conferenceState = "ready";
  await delivery.processDue(1);
  const meeting = await binding.prepare("SELECT meeting_state AS meetingState, meeting_url AS meetingUrl FROM bookings WHERE id = 'pending-booking'").first<{ meetingState: string; meetingUrl: string }>();
  const link = await binding.prepare("SELECT count(*) AS count FROM delivery_outbox WHERE idempotency_key = 'booking:pending-booking:occurrence:pending-occurrence:link-ready'").first<{ count: number }>();
  return { pendingState: pending.state, pollAttempt: JSON.parse(pending.payloadJson).conferencePollAttempt, meeting, linkReadyCommands: link?.count ?? 0 };
}

async function seedCalendarCommand(binding: D1Database, bookingId: string, occurrenceId: string, commandId: string, timestamp: string) {
  const startAt = "2030-06-03T10:00:00.000Z";
  const endAt = "2030-06-03T10:30:00.000Z";
  const manageToken = createOpaqueToken();
  const manageUrl = new URL(`/manage/${manageToken}`, runtime.APP_URL).toString();
  const manageTokenHash = await hashToken(manageToken, runtime.SESSION_SECRET);
  const oldOccurrenceId = `${occurrenceId}-old`;
  const oldManageToken = createOpaqueToken();
  const oldManageUrl = new URL(`/manage/${oldManageToken}`, runtime.APP_URL).toString();
  const oldManageTokenHash = await hashToken(oldManageToken, runtime.SESSION_SECRET);
  const oldMailUpdatedAt = new Date(Date.parse(timestamp) + 60_000).toISOString();
  const confirmation = bookingConfirmationMail({
    hostName: "Provider host", eventTitle: "Provider event", startAt, endAt, durationMinutes: 30,
    inviteeTimezone: "UTC", hostTimezone: "Australia/Brisbane", locationType: "google_meet",
    locationLabel: "Google Meet", locationValue: "", meetingUrl: null, calendarState: "pending",
    recipientRole: "invitee", inviteeName: "Invitee", inviteeEmail: "invitee@dial.test", answers: [], manageUrl,
  });
  const confirmationPayload = {
    to: "invitee@dial.test", recipientRole: "invitee", manageUrl,
    subject: "Confirmed: Provider event", ...confirmation,
  };
  // C.1 link-ready mail uses the invitee capability established by a completed confirmation.
  // The prior occurrence's revoked capability is deliberately updated later to prove occurrence binding.
  await binding.batch([
    binding.prepare("INSERT OR IGNORE INTO host_profiles (id, singleton_key, handle, name, title, biography, timezone, created_at, updated_at) VALUES ('provider-profile', 'default', 'provider-host', 'Provider host', 'Host', 'Provider fixture host', 'Australia/Brisbane', ?, ?)").bind(timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO bookings (id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value, invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_state, meeting_state, meeting_url, current_occurrence_id, created_at, updated_at) VALUES (?, NULL, 'provider-event', 'Provider event', 30, 'google_meet', 'Google Meet', '', 'Invitee', 'invitee@dial.test', 'Australia/Brisbane', 'UTC', 'confirmed', ?, 'pending', 'pending', NULL, ?, ?, ?)").bind(bookingId, `dial-${bookingId}@dial`, occurrenceId, timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at, closed_at) VALUES (?, ?, 0, '2030-05-31T10:00:00.000Z', '2030-05-31T10:30:00.000Z', '2030-05-31T10:00:00.000Z', '2030-05-31T10:30:00.000Z', '2030-05-31', 'rescheduled', 0, ?, ?)").bind(oldOccurrenceId, bookingId, timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, '2030-06-03', 'current', 1, ?)").bind(occurrenceId, bookingId, startAt, endAt, startAt, endAt, timestamp),
    binding.prepare("INSERT OR IGNORE INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, rotated_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`${bookingId}-old-manage`, bookingId, oldManageTokenHash, new Date(Date.parse(startAt) + 90 * 86400000).toISOString(), timestamp, timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO booking_manage_tokens (id, booking_id, token_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(`${bookingId}-manage`, bookingId, manageTokenHash, new Date(Date.parse(startAt) + 90 * 86400000).toISOString(), timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) VALUES (?, 'mail_send', ?, ?, ?, NULL, ?, 'succeeded', 1, ?, NULL, ?, ?, ?)").bind(`${bookingId}-old-confirmation`, `booking:${bookingId}:occurrence:${oldOccurrenceId}:mail:invitee:invitee@dial.test`, bookingId, oldOccurrenceId, JSON.stringify({ to: "invitee@dial.test", recipientRole: "invitee", manageUrl: oldManageUrl, subject: "Confirmed: Previous provider event", text: `Confirmed: Previous provider event\nManage this booking: ${oldManageUrl}` }), timestamp, timestamp, timestamp, oldMailUpdatedAt),
    binding.prepare("INSERT OR IGNORE INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, last_error_code, succeeded_at, created_at, updated_at) VALUES (?, 'mail_send', ?, ?, ?, NULL, ?, 'succeeded', 1, ?, NULL, ?, ?, ?)").bind(`${bookingId}-confirmation`, `booking:${bookingId}:occurrence:${occurrenceId}:mail:invitee:invitee@dial.test`, bookingId, occurrenceId, JSON.stringify(confirmationPayload), timestamp, timestamp, timestamp, timestamp),
    binding.prepare("INSERT OR IGNORE INTO delivery_attempts (id, outbox_id, attempt_number, outcome, provider_message_id, error_code, attempted_at) VALUES (?, ?, 1, 'succeeded', NULL, NULL, ?)").bind(`${bookingId}-confirmation-attempt`, `${bookingId}-confirmation`, timestamp),
    binding.prepare("INSERT OR IGNORE INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at) VALUES (?, 'calendar_upsert', ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ?)").bind(commandId, `booking:${bookingId}:occurrence:${occurrenceId}:calendar`, bookingId, occurrenceId, JSON.stringify({ bookingId, occurrenceId, icalUid: `dial-${bookingId}@dial`, eventTitle: "Provider event", startAt, endAt, hostTimezone: "Australia/Brisbane", invitee: { name: "Invitee", email: "invitee@dial.test" }, location: "", locationType: "google_meet" }), timestamp, timestamp, timestamp),
  ]);
  return { manageUrl };
}
