import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import { createApp } from "../../src/core/app/hono";
import { createServices } from "../../src/core/app/services";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { bookingMutationTarget, forwardBookingRequest, coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { createId } from "../../src/core/shared/ids";
import type { AppBindings } from "../../src/core/app/bindings";
import { MicrosoftCalendarAdapter } from "../../src/core/platform/calendar/microsoft";
import { GoogleCalendarAdapter } from "../../src/core/platform/calendar/google";
import { BaseMailSender } from "../../src/core/platform/mail/base-mail";
import { handleFixtures } from "../review/fixture-routes";
import { consumeJobs, runScheduledWork } from "../../src/core/app/background-work";
import { initializeWire, wireTransport } from "./transport";
import { connectionWatchObservers } from "../../src/core/app/connection-watch";
import { captureAuthMail, captureMail, capturedMail } from "../mail-capture";
import { paymentFixtures } from "./payment-fixtures";
// STRIPE_EDGE=live is the local-only PAY-001 test-mode proof: Stripe calls go to api.stripe.com.
type WireBindings = AppBindings & { PROVIDER_DB?: D1Database; STRIPE_EDGE?: "live"; STRIPE_EDGE_RELAY?: string };
// A sandbox without direct egress relays the unchanged request bytes through a local forwarder to Stripe.
const liveStripe = (relay?: string): typeof fetch => relay ? (input, init) => { const url = new URL(String(input)); return fetch(`${relay}/${url.hostname}${url.pathname}${url.search}`, init); } : fetch;
const providerDb = (env: WireBindings) => env.PROVIDER_DB ?? env.DB;
const servicesFor = (env: WireBindings) => {
  const runtime = parseRuntimeEnvironment(env), wire = wireTransport(providerDb(env));
  return createServices(env.DB, runtime, env.ASSETS, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), files: env.FILES, calendar: runtime.CALENDAR_PROVIDER === "microsoft" ? new MicrosoftCalendarAdapter({ clientId: runtime.MICROSOFT_OAUTH_CLIENT_ID!, clientSecret: runtime.MICROSOFT_OAUTH_CLIENT_SECRET! }, wire) : new GoogleCalendarAdapter({ clientId: "wire-client", clientSecret: "wire-secret" }, wire), authMail: captureAuthMail(env.DB), mail: runtime.MAIL_PROVIDER === "development" ? captureMail(env.DB) : new BaseMailSender(env.DB, { ...runtime, ENVIRONMENT: "production" }, wire), calendarChanges: coordinatedCalendarChanges(env), connectionWatch: connectionWatchObservers(env), paymentsClock: async () => { const row = await providerDb(env).prepare("SELECT value FROM wire_controls WHERE name='entitlement-clock'").first<{ value: number }>(); return row?.value ? new Date(row.value) : new Date(); }, paymentsTransport: env.STRIPE_EDGE === "live" ? liveStripe(env.STRIPE_EDGE_RELAY) : wire });
};
export class BookingCoordinator extends ProductionCoordinator { protected services(env: WireBindings) { return servicesFor(env); } }
const app = createApp(undefined, servicesFor);
export default {
  async fetch(request: Request, env: WireBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (url.pathname === "/__test/mail") return capturedMail(env.DB);
    if (url.pathname === "/wire/init") { await initializeWire(providerDb(env)); return Response.json({ ok: true }); }
    if (url.pathname === "/wire/state") {
      const tables = ["meeting_polls", "poll_candidates", "poll_participants", "poll_votes", "poll_vote_tokens", "calendar_connection_health_changes", "calendar_push_channels", "calendar_busy_read_windows", "calendar_busy_intervals", "wire_calls", "wire_events", "booking_reschedule_requests", "booking_request_history", "booking_links", "event_booking_policies", "booking_presentation", "event_correspondence", "booking_correspondence", "base_mail_dispatch", "calendar_connections", "bookings", "booking_guests", "booking_approval_requests", "booking_approval_tokens", "booking_occurrences", "booking_nonces", "booking_history", "booking_calendar_conflicts", "delivery_outbox", "delivery_attempts", "availability_requests", "availability_request_windows", "calendar_deletion_probes", "payment_processor_facts", "accounting_connections", "accounting_exports", "accounting_oauth_states", "payment_connections", "payment_oauth_states", "payment_holds", "booking_payments", "event_type_prices", "event_type_payment_terms", "booking_payment_terms", "booking_card_consents", "payment_link_tokens", "payment_movements", "payment_settings", "anonymized_audit", "person_erasure_receipts", "wire_stripe_sessions", "wire_stripe_objects"];
      return Response.json(Object.fromEntries(await Promise.all(tables.map(async table => [table, (await (table.startsWith("wire_") ? providerDb(env) : env.DB).prepare(`SELECT * FROM ${table}`).all()).results]))));
    }
    if (url.pathname.startsWith("/__fixtures/payments/")) return paymentFixtures(url, request, env.DB, providerDb(env), servicesFor(env));
    if (url.pathname === "/__fixtures/calendar-token-expired") { await env.DB.prepare("UPDATE calendar_connections SET access_token_expires_at='2000-01-01T00:00:00.000Z'").run(); return new Response(null, { status: 204 }); }
    if (url.pathname === "/__fixtures/calendar-cache-expired") { await env.DB.prepare("UPDATE calendar_busy_read_windows SET observed_at='2000-01-01T00:00:00.000Z'").run(); return new Response(null, { status: 204 }); }
    if (url.pathname === "/__fixtures/calendar-channel-expiry") {
      const { expiresAt } = await request.json<{ expiresAt: string }>();
      await env.DB.prepare("UPDATE calendar_push_channels SET expires_at=?").bind(expiresAt).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/invitation-start") {
      const { id, startAt } = await request.json<{ id: string; startAt: string }>();
      await env.DB.prepare("UPDATE booking_occurrences SET start_at=? WHERE id=(SELECT current_occurrence_id FROM bookings WHERE id=?)").bind(startAt,id).run();
      return new Response(null,{status:204});
    }
    if (url.pathname === "/__fixtures/manage-expiry") {
      const { id } = await request.json<{ id: string }>();
      await env.DB.prepare("UPDATE booking_manage_tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE booking_id=?").bind(id).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/expire-link") {
      const {id}=await request.json<{id:string}>();
      await env.DB.prepare("UPDATE booking_links SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();
      return new Response(null,{status:204});
    }
    if(url.pathname==="/__fixtures/approval-expiry" && request.method==="POST"){const {id}=await request.json<{id:string}>();await env.DB.prepare("UPDATE booking_approval_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();await import("../../src/core/app/booking-coordination").then(module=>module.processDueApprovalRequests(env));return new Response(null,{status:204});}
    if (url.pathname === "/__fixtures/request-time") {
      const {id,now}=await request.json<{id:string;now:string}>();
      await servicesFor(env).bookings.processRescheduleRequest(id,new Date(now));
      return new Response(null,{status:204});
    }
    if (url.pathname === "/wire/delete") {
      const { id } = await request.json<{ id: string }>();
      await providerDb(env).prepare("UPDATE wire_events SET payload=json_remove(json_set(payload,'$.status','cancelled'),'$.updated') WHERE id=?").bind(id).run();
      // Untimed notification is only a wake-up. Production must inspect GET + authoritative list.
      await servicesFor(env).calendar.syncManagedEvents();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/wire/control") {
      const { name, value } = await request.json<{ name: string; value: string | number }>();
      await providerDb(env).prepare("INSERT INTO wire_controls VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").bind(name, value).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/wire/event") {
      const { id, payload, remove } = await request.json<{ id: string; payload?: unknown; remove?: boolean }>();
      if (remove) await providerDb(env).prepare("DELETE FROM wire_events WHERE id=?").bind(id).run();
      else await providerDb(env).prepare("INSERT INTO wire_events(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(id, JSON.stringify(payload)).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/wire/sync") return Response.json(await servicesFor(env).calendar.syncManagedEvents());
    if (url.pathname === "/wire/health-failure") {
      const { enabled } = await request.json<{ enabled: boolean }>();
      await providerDb(env).prepare("INSERT INTO wire_controls VALUES('mail-health-failure',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").bind(enabled ? 1 : 0).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/wire/ambiguous") {
      await providerDb(env).prepare("INSERT INTO wire_controls VALUES('mail-ambiguous',1) ON CONFLICT(name) DO UPDATE SET value=1").run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/wire/legacy-mail") {
      const { bookingId } = await request.json<{ bookingId: string }>();
      const booking = await env.DB.prepare("SELECT current_occurrence_id AS occurrenceId, invitee_email AS inviteeEmail FROM bookings WHERE id = ? AND state IN ('confirmed', 'rescheduled')").bind(bookingId).first<{ occurrenceId: string; inviteeEmail: string }>();
      if (!booking) return new Response("Booking is unavailable", { status: 404 });
      // C.1's retry journey uses production's 26-character delivery ID contract for this legacy row.
      const id = createId();
      // This fixture represents an already-queued pre-C.1 plain-only mail row.
      const payload = { to: booking.inviteeEmail, recipientRole: "invitee", subject: "Legacy plain retry", text: "Legacy plain body" };
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO delivery_outbox (id, kind, idempotency_key, booking_id, occurrence_id, request_id, payload_json, state, attempts, next_attempt_at, created_at, updated_at) VALUES (?, 'mail_send', ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, ?)").bind(id, `legacy-plain:${id}`, bookingId, booking.occurrenceId, JSON.stringify(payload), now, now, now).run();
      return Response.json({ id });
    }
    if (url.pathname.startsWith("/__fixtures/")) return handleFixtures(request, env, servicesFor);
    const target = await bookingMutationTarget(request, env);
    return target ? forwardBookingRequest(env, target, request) : app.fetch(request, env, context);
  },
  // Production's own Queue and Cron handlers, over the wire providers.
  async queue(batch: MessageBatch<unknown>, env: WireBindings) { await consumeJobs(batch, env, servicesFor(env)); },
  async scheduled(_controller: ScheduledController, env: WireBindings) { await runScheduledWork(env, servicesFor(env)); },
};
