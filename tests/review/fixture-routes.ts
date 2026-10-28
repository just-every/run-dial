import { analyticsFixtures } from "../booking-wire/analytics-wire";
import { noticeFixtures } from '../booking-wire/notice-fixtures';
import { paymentFixtures } from "../booking-wire/payment-fixtures";
import { CalendarConnectionRepository } from "../../src/core/features/calendar-connection";
import { processCoordinatedDelivery, coordinatedCalendarChanges, processDueApprovalRequests } from "../../src/core/app/booking-coordination";
import { DeliveryRepository } from "../../src/core/features/delivery";
import { calendarChangeSchema } from "../../src/core/features/calendar-connection";
import type { AppBindings } from "../../src/core/app/bindings";
import type { AppServices } from "../../src/core/app/services";
import { EventTypesRepository } from "../../src/core/features/event-types";
import { bulkBookingsFixture } from "./bookings-fixture";
import { seedReportMonth } from "./report-month";
import { setup, status } from "./setup";

export async function handleFixtures(request: Request, env: AppBindings & { PROVIDER_DB?: D1Database }, servicesFor: (env: AppBindings) => AppServices) {
  const url = new URL(request.url);
    if (url.pathname === "/__fixtures/avatar-objects") {
      if (request.method === "POST") await env.FILES.put("private/audit-non-avatar", "Test-only private object", { httpMetadata: { contentType: "text/plain" } });
      const listed = await env.FILES.list();
      return Response.json({ keys: listed.objects.map(object => object.key) });
    }
  const providerDb = env.PROVIDER_DB ?? env.DB;
  if(url.pathname.startsWith("/__fixtures/analytics/")) return analyticsFixtures(url,request,env.DB,providerDb);
  if(url.pathname.startsWith("/__fixtures/notices/"))return noticeFixtures(url,request,env.DB,providerDb);
    if (url.pathname.startsWith("/__fixtures/payments/")) return paymentFixtures(url, request, env.DB, providerDb, servicesFor(env));
    if(url.pathname==="/__fixtures/approval-expiry"&&request.method==="POST"){const {id}=await request.json<{id:string}>();await env.DB.prepare("UPDATE booking_approval_requests SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(id).run();await processDueApprovalRequests(env);return new Response(null,{status:204});}
    if (url.pathname === "/__fixtures/booking-ended" && request.method === "POST") {
      const { id } = await request.json<{ id: string }>();
      const end = new Date(Date.now() - 86400000);
      const start = new Date(end.getTime() - 1800000);
      await env.DB.prepare("UPDATE booking_occurrences SET start_at = ?, end_at = ? WHERE id = (SELECT current_occurrence_id FROM bookings WHERE id = ?)").bind(start.toISOString(), end.toISOString(), id).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/report-month" && request.method === "POST") return Response.json(await seedReportMonth(env.DB, await request.json()));
    if (url.pathname === "/__fixtures/bookings-501") return bulkBookingsFixture(request, env, servicesFor(env));
    if (url.pathname === "/__fixtures/setup" && request.method === "POST") return Response.json(await setup(env, servicesFor(env)));
    if (url.pathname === "/__fixtures/schedule" && request.method === "POST") {
      const { schedule } = await request.json<{ schedule: "all-day" | "working-day" }>();
      const repository = new EventTypesRepository(env.DB);
      const event = await repository.getBySlug("intro");
      if (!event || !["all-day", "working-day"].includes(schedule)) return new Response(null, { status: 400 });
      await env.DB.prepare("UPDATE recurring_availability_windows SET start_minute = ?, end_minute = ? WHERE event_type_id = ?").bind(schedule === "working-day" ? 540 : 0, schedule === "working-day" ? 1020 : 1440, event.id).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/reset" && request.method === "POST") {
      await env.DB.batch(["delivery_outbox", "booking_nonces", "bookings", "availability_request_review_nonces", "availability_requests", "anonymized_audit", "erased_calendar_targets"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
      await providerDb.batch(["fixture_mail", "fixture_events", "fixture_controls", "fixture_activity"].map((table) => providerDb.prepare(`DELETE FROM ${table}`)));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/calendar-health" && request.method === "POST") {
      const input = await request.json<{ healthy: boolean }>();
      if (input.healthy) await servicesFor(env).calendar.checkConnection();
      else { const repository = new CalendarConnectionRepository(env.DB); await repository.clearSyncCursor(); await repository.markUnhealthy("provider_timeout"); }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/status") return Response.json(await status(env.DB, providerDb));
    if (url.pathname === "/__fixtures/control" && request.method === "POST") {
      const input = await request.json<{ kind: string; failure?: boolean; delayMs?: number }>();
      await providerDb.prepare("INSERT INTO fixture_controls (kind, failure, delay_ms) VALUES (?, ?, ?) ON CONFLICT(kind) DO UPDATE SET failure = excluded.failure, delay_ms = excluded.delay_ms").bind(input.kind, input.failure ? 1 : 0, input.delayMs ?? 0).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/deliver" && request.method === "POST") {
      const input = await request.json<{ id?: string; channel?: "notice" | "analytics" }>();
      if(input.channel && input.id){const job={outboxId:input.id,channel:input.channel};await processCoordinatedDelivery(job,env,()=>servicesFor(env).delivery.processUnknown(job));return Response.json({attempted:1});}
      const ids = input.id ? [input.id] : await new DeliveryRepository(env.DB).dueIds(new Date().toISOString(), 100);
      const results = await Promise.all(ids.map((outboxId) => processCoordinatedDelivery({ outboxId }, env, () => servicesFor(env).delivery.processUnknown({ outboxId }))));
      const noticeIds=await servicesFor(env).notices.delivery.dueIds(new Date().toISOString(),100);
      const noticeResults=await Promise.all(noticeIds.map(outboxId=>processCoordinatedDelivery({outboxId,channel:"notice"},env,()=>servicesFor(env).delivery.processUnknown({outboxId,channel:"notice"}))));
      const analyticsIds = await servicesFor(env).analytics.delivery.dueIds(new Date().toISOString(),100);
      for (const outboxId of analyticsIds) { const job = {outboxId,channel:"analytics" as const}; await processCoordinatedDelivery(job,env,()=>servicesFor(env).delivery.processUnknown(job)); }
      return Response.json({ attempted: results.length+noticeResults.length+analyticsIds.length });
    }
    if (url.pathname === "/__fixtures/due" && request.method === "POST") {
      const input = await request.json<{ id: string; processing?: boolean }>();
      await env.DB.prepare("UPDATE delivery_outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z', updated_at = '2000-01-01T00:00:00.000Z', state = ? WHERE id = ?").bind(input.processing ? "processing" : "pending", input.id).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/change" && request.method === "POST") { await coordinatedCalendarChanges(env).reconcileCalendarChange(calendarChangeSchema.parse(await request.json())); return new Response(null, { status: 204 }); }
    return new Response("Not found", { status: 404 });
}
