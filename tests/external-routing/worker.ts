import production, { BookingCoordinator } from "../ux-simplification/worker";
import { createServices } from "../../src/core/app/services";
import type { AppBindings } from "../../src/core/app/bindings";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { EventTypesRepository } from "../../src/core/features/event-types";
import { RoutingRepository } from "../../src/core/features/routing";
import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";

export { BookingCoordinator };
const every = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));
const count = (db: D1Database, table: string) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>().then(row => row?.n ?? 0);

export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/__fixtures/external-routing")) return production.fetch(request, env, context);
    const services = createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR) });
    const events = new EventTypesRepository(env.DB);
    if (url.pathname === "/__fixtures/external-routing/seed" && request.method === "POST") {
      // An ordinary single-host, free, unapproved fixed-location event without guests, plus the routing form that reaches it.
      const profile = await services.hostProfile.getProfile();
      const event = await events.create({ slug: "route-consult", title: "Route consultation", description: "Plan the work with the host.", durationMinutes: 30, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video call", locationValue: "https://meet.example.test/route", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [{ kind: "text", key: "q_goal", label: "Goal of the call", required: false, options: [] }, { kind: "text", key: "q_team", label: "Team size", required: false, options: [] }], availability: every });
      await events.setStatus(event.id, "published");
      const form = await new RoutingRepository(env.DB).create({
        title: "Website enquiry",
        questions: [{ key: "purpose", label: "Purpose", required: true }, { key: "company", label: "Company", required: false }],
        rules: [{ id: "consult", questionKey: "purpose", equals: "consult", eventTypeId: event.id }],
        defaultMessage: "Thanks, the team will email you instead.",
      }, profile!.id);
      return Response.json({ formId: form.id, eventId: event.id });
    }
    if (url.pathname === "/__fixtures/external-routing/event" && request.method === "POST") {
      const { id, status } = await request.json<{ id: string; status: "published" | "disabled" }>();
      await events.setStatus(id, status);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/external-routing/expire" && request.method === "POST") {
      await env.DB.prepare("UPDATE routing_capabilities SET expires_at='2000-01-01T00:00:00.000Z' WHERE consumed_at IS NULL").run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/external-routing/state") {
      const submissions = (await env.DB.prepare("SELECT id,state,rule_id AS ruleId FROM routing_submissions ORDER BY created_at,id").all()).results;
      const tables = Object.fromEntries(await Promise.all(["bookings", "delivery_outbox", "booking_nonces", "routing_capabilities"].map(async table => [table, await count(env.DB, table)])));
      const bookingRows = (await env.DB.prepare("SELECT invitee_name AS name, invitee_email AS email FROM bookings ORDER BY created_at,id").all()).results;
      return Response.json({ submissions, bookingRows, ...tables });
    }
    return new Response("Not found", { status: 404 });
  },
};
