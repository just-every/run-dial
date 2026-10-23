import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import start from "@tanstack/react-start/server-entry";
import { z } from "zod";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { PublicAdmissionGate, PublicAdmissionError } from "../../src/core/platform/public-admission";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";

const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), ...fixtureProviders(env.DB), calendarChanges: coordinatedCalendarChanges(env) });
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
const inputSchema = z.object({
  path: z.string().max(512).regex(/^\/(api\/(public|webhooks)\/|book\/|assets\/|_serverFn\/)/),
  method: z.enum(["GET", "POST"]).default("GET"),
  ip: z.string().max(80).optional(), forwardedFor: z.string().max(80).optional(),
  provider: z.enum(["google_calendar", "resend"]).optional(),
  now: z.number().int().min(0).max(4102444800000).optional(),
  count: z.number().int().min(1).max(650).default(1),
  uniqueClients: z.boolean().default(false), concurrent: z.boolean().default(false), production: z.boolean().default(false),
}).strict();

export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (!url.pathname.startsWith("/__fixtures/admission/")) return url.pathname.startsWith("/__fixtures/") ? handleFixtures(request, env, servicesFor) : production.fetch(request, env, context);
    if (url.pathname === "/__fixtures/admission/state" && request.method === "GET") {
      const tables = ["provider_webhook_events", "calendar_busy_intervals", "calendar_busy_read_windows", "delivery_outbox", "fixture_activity"];
      const effects = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results])));
      return Response.json({ rates: (await env.DB.prepare("SELECT * FROM public_rate_events ORDER BY id").all()).results, columns: (await env.DB.prepare("PRAGMA table_info(public_rate_events)").all()).results, effects });
    }
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    if (url.pathname === "/__fixtures/admission/admit") {
      const parsed = inputSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: "invalid_fixture_input" }, { status: 400 });
      const input = parsed.data;
      const runtime = parseRuntimeEnvironment(env);
      const gate = new PublicAdmissionGate(env.DB, input.production ? { ...runtime, ENVIRONMENT: "production" } : runtime);
      const one = async (index: number) => {
        const headers = new Headers();
        const ip = input.uniqueClients ? `198.18.${Math.floor(index / 250)}.${index % 250 + 1}` : input.ip;
        if (ip !== undefined) headers.set("CF-Connecting-IP", ip);
        if (input.forwardedFor) headers.set("X-Forwarded-For", input.forwardedFor);
        try { return await gate.admit(new Request(new URL(input.path, runtime.APP_URL), { method: input.method, headers }), input.provider, input.now); }
        catch (error) { if (error instanceof PublicAdmissionError) return { kind: "error", code: error.code }; throw error; }
      };
      const results = [];
      if (input.concurrent) results.push(...await Promise.all(Array.from({ length: input.count }, (_, index) => one(index))));
      else for (let index = 0; index < input.count; index++) results.push(await one(index));
      return Response.json({ results });
    }
    if (url.pathname === "/__fixtures/admission/reset") { await env.DB.prepare("DELETE FROM public_rate_events").run(); return new Response(null, { status: 204 }); }
    if (url.pathname === "/__fixtures/admission/expire") {
      const input = z.object({ now: z.number().int().min(0).max(4102444800000) }).strict().parse(await request.json());
      await new PublicAdmissionGate(env.DB, parseRuntimeEnvironment(env)).expire(input.now); return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/admission/table") {
      const { disabled } = z.object({ disabled: z.boolean() }).strict().parse(await request.json());
      await env.DB.prepare(disabled ? "ALTER TABLE public_rate_events RENAME TO fixture_missing_public_rate_events" : "ALTER TABLE fixture_missing_public_rate_events RENAME TO public_rate_events").run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/admission/channels") {
      await servicesFor(env).delivery.renewCalendarChannels();
      const timestamp = new Date().toISOString();
      await env.DB.prepare("INSERT OR IGNORE INTO calendar_push_channels (id, calendar_id, provider_channel_id, provider_resource_id, expires_at, created_at, updated_at) VALUES ('admission-second-channel', 'synthetic-second-calendar', 'synthetic-second-channel', 'synthetic-second-resource', '2035-01-01T00:00:00.000Z', ?, ?)").bind(timestamp, timestamp).run();
      return Response.json({ channels: (await env.DB.prepare("SELECT * FROM calendar_push_channels").all()).results });
    }
    return new Response("Not found", { status: 404 });
  },
};
