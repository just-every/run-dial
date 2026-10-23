import { createApp } from "../../src/core/app/hono";
import { createServices } from "../../src/core/app/services";
import { MicrosoftCalendarAdapter } from "../../src/core/platform/calendar/microsoft";
import type { ManagedCalendarEvent } from "../../src/core/platform/calendar";
import type { AppBindings } from "../../src/core/app/bindings";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { SyntheticGraph } from "./graph";
export const graph = new SyntheticGraph();
const assets = { fetch: async () => new Response("Synthetic document") } as Fetcher;
const servicesFor = (env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), assets, { calendar: new MicrosoftCalendarAdapter({ clientId: "synthetic-dial-1607", clientSecret: "synthetic-dial-1608" }, graph.request) });
const app = createApp(undefined, servicesFor);
const event: ManagedCalendarEvent = { bookingId: "synthetic-dial-1609", occurrenceId: "synthetic-dial-1610", idempotencyKey: "synthetic-dial-1611", icalUid: "synthetic-dial-1609@dial", title: "Synthetic invitation title", description: "Synthetic description\nhttps://dial.example.test/manage/invite/synthetic-dial-1612", location: "Synthetic room", startAt: "2030-06-03T11:00:00.000Z", endAt: "2030-06-03T11:30:00.000Z", timeZone: "Australia/Brisbane", inviteeEmail: "synthetic-dial-1613@example.test", requestGoogleMeet: false, requestMicrosoftTeams: true };
export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const path = new URL(request.url).pathname, services = servicesFor(env);
    if (path === "/__fixtures/delivery") return Response.json(await services.delivery.processDue(50));
    if (path === "/__fixtures/cancellations") return Response.json(await env.DB.prepare("SELECT count(*) AS count FROM booking_history WHERE booking_id=? AND action='cancelled'").bind(new URL(request.url).searchParams.get("id")).first());
    if (path === "/__fixtures/facts") {
      const credentials = await env.DB.prepare("SELECT calendar_provider,access_token_ciphertext,refresh_token_ciphertext FROM calendar_connections").first<{ calendar_provider: string; access_token_ciphertext: string; refresh_token_ciphertext: string }>();
      const busy = await env.DB.prepare("SELECT * FROM calendar_busy_intervals").all();
      return Response.json({ provider: credentials?.calendar_provider, sealed: Boolean(credentials?.access_token_ciphertext && !credentials.access_token_ciphertext.includes("synthetic-dial-1600") && !credentials.refresh_token_ciphertext.includes("synthetic-dial-1601")), calls: graph.calls, events: [...graph.events.values()], subscriptions: [...graph.subscriptions], busy: busy.results, mail: (await env.DB.prepare("SELECT booking_id AS bookingId,payload_json AS payload FROM delivery_outbox WHERE kind='mail_send'").all<{ bookingId: string; payload: string }>()).results.map(row => ({ bookingId: row.bookingId, payload: JSON.parse(row.payload) })) });
    }
    if (path === "/__fixtures/control") {
      const input = await request.json<{ refusedRefresh?: boolean; unreadable?: boolean; expire?: boolean; loseCreateResponse?: boolean; expireChannels?: boolean; deleteEvents?: boolean }>();
      if (input.refusedRefresh !== undefined) graph.refusedRefresh = input.refusedRefresh;
      if (input.unreadable !== undefined) graph.unreadable = input.unreadable;
      if (input.loseCreateResponse !== undefined) graph.loseCreateResponse = input.loseCreateResponse;
      if (input.expire) await env.DB.prepare("UPDATE calendar_connections SET access_token_expires_at='2000-01-01T00:00:00.000Z'").run();
      if (input.expireChannels) await env.DB.prepare("UPDATE calendar_push_channels SET expires_at=?").bind(new Date(Date.now() + 60000).toISOString()).run();
      if (input.deleteEvents) { for (const id of graph.events.keys()) graph.deleted.push(id); graph.events.clear(); }
      return new Response(null, { status: 204 });
    }
    if (path === "/__fixtures/busy") return Response.json(await services.calendar.readBusy({ startAt: "2030-06-03T00:00:00.000Z", endAt: "2030-06-04T00:00:00.000Z", freshness: new URL(request.url).searchParams.get("fresh") === "1" ? "fresh" : "cached" }));
    if (path === "/__fixtures/event") {
      const input = await request.json<{ move?: boolean; phone?: boolean; cancel?: boolean }>();
      if (input.cancel) { await services.calendar.cancelManagedEvent(event.bookingId); return Response.json({ cancelled: true }); }
      try { return Response.json(await services.calendar.upsertManagedEvent({ ...event, ...(input.move ? { occurrenceId: "synthetic-dial-1614", startAt: "2030-06-04T11:00:00.000Z", endAt: "2030-06-04T11:30:00.000Z", title: "Synthetic updated title" } : {}), ...(input.phone ? { bookingId: "synthetic-dial-1615", requestMicrosoftTeams: false, location: "+12025550160" } : {}) })); }
      catch { return Response.json({ lostResponse: true }, { status: 503 }); }
    }
    if (path === "/__fixtures/sync") return Response.json(await services.calendar.syncManagedEvents());
    if (path === "/__fixtures/renew") return Response.json(await services.calendar.renewExpiringPushChannels());
    return app.fetch(request, env, context);
  },
  async queue(batch: MessageBatch<unknown>) { for (const message of batch.messages) message.ack(); },
} satisfies ExportedHandler<AppBindings>;
