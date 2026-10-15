import { ensureTestOperator } from "./auth-fixture";
import { Hono } from "hono";
import { AvailabilityRepository, AvailabilityService, type CalendarBusyReader } from "../src/core/features/availability";
import { BookingsRepository, BookingsService } from "../src/core/features/bookings";
import type { AppEnvironment } from "../src/core/app/context";
import type { AppServices } from "../src/core/app/services";
import { EventTypesRepository, EventTypesService } from "../src/core/features/event-types";
import { eventTypeRoutes } from "../src/core/features/event-types/routes";
import { HostProfileRepository } from "../src/core/features/host-profile/repository";
import { HostProfileService } from "../src/core/features/host-profile/service";
import { OperatorsService } from "../src/core/features/operators";
import { publicBookingRoutes } from "../src/core/features/public-booking/routes";
import { hashToken } from "../src/core/platform/auth/tokens";
import type { RuntimeEnvironment } from "../src/core/shared/runtime-env";

type Bindings = { DB: D1Database };
const runtime: RuntimeEnvironment = { ENVIRONMENT: "development", APP_URL: "http://dial.test", SESSION_SECRET: "synthetic-booking-http-worker-test-secret-not-used-by-the-app" };
const calendar: CalendarBusyReader = { async readBusy() { return { kind: "ok", observedAt: new Date().toISOString(), intervals: [] }; } };

export default {
  async fetch(request: Request, env: Bindings) {
    if (new URL(request.url).pathname === "/fixture") {
      await fixture(env.DB);
      return Response.json({ ok: true });
    }
    if (new URL(request.url).pathname === "/status") {
      const bookings = await env.DB.prepare("SELECT count(*) AS count FROM bookings").first<{ count: number }>();
      const outbox = await env.DB.prepare("SELECT kind, payload_json AS payloadJson FROM delivery_outbox ORDER BY kind").all<{ kind: string; payloadJson: string }>();
      return Response.json({ bookings: bookings?.count ?? 0, outbox: outbox.results.map((row) => ({ kind: row.kind, payload: JSON.parse(row.payloadJson) })) });
    }
    if (new URL(request.url).pathname === "/expire-selection" && request.method === "POST") {
      const { nonce } = await request.json<{ nonce: string }>();
      await env.DB.prepare("UPDATE booking_nonces SET expires_at = ? WHERE nonce_hash = ?").bind("2000-01-01T00:00:00.000Z", await hashToken(nonce, runtime.SESSION_SECRET)).run();
      return Response.json({ ok: true });
    }
    const services = servicesFor(env.DB);
    const app = new Hono<AppEnvironment>().use("*", async (context, next) => {
      context.set("runtime", runtime);
      context.set("services", services as AppServices);
      await next();
    }).route("/", eventTypeRoutes).route("/", publicBookingRoutes);
    return app.fetch(request, env as never);
  },
};

function servicesFor(binding: D1Database) {
  const hostProfile = new HostProfileService(new HostProfileRepository(binding));
  const eventTypes = new EventTypesService(new EventTypesRepository(binding), hostProfile);
  const availability = new AvailabilityService(new AvailabilityRepository(binding), hostProfile, eventTypes, calendar);
  return {
    operators: new OperatorsService(binding, runtime),
    hostProfile,
    eventTypes,
    availability,
    bookings: new BookingsService(new BookingsRepository(binding), availability, hostProfile, eventTypes, runtime),
    spaSurface: { async serve(_request: Request, status: number) { return new Response("surface", { status }); } },
  };
}

async function fixture(binding: D1Database) {
  const services = servicesFor(binding);
  await ensureTestOperator(binding, "operator@dial.test");
  if (!(await services.hostProfile.getProfile())) {
    await services.hostProfile.saveProfile({ handle: "dial-host", name: "Dial Host", title: "Host", biography: "Booking tests", timezone: "UTC", focusAreas: [], socialProof: [] });
  }
  const repository = new EventTypesRepository(binding);
  let event = await repository.getBySlug("intro");
  if (!event) {
    event = await repository.create({
      slug: "intro", title: "Introductory call", description: "A real Hono booking test", durationMinutes: 30, color: "#176b5a",
      locationType: "google_meet", locationLabel: "Google Meet", locationValue: "", listed: true, alternativeRequestsEnabled: false,
      slotIncrementMinutes: 15, minimumNoticeMinutes: 0, bookingHorizonDays: 365, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null,
      questions: [{ kind: "single_choice", label: "Goal", required: true, options: [{ value: "review", label: "Review" }] }],
      availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })),
    });
  }
  await repository.setStatus(event.id, "published");
}
