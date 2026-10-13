import start from "@tanstack/react-start/server-entry";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";
import { setup, status } from "../review/setup";
import { ProviderFailure } from "../../src/core/platform/calendar";

type SyntheticBusy = { startAt: string; endAt: string; summary: string; providerEventId: string; attendeeEmail: string };
function servicesFor(env: AppBindings) {
  const providers = fixtureProviders(env.DB), readBusy = providers.calendar.readBusy.bind(providers.calendar);
  const destination = providers.calendar.checkDestination.bind(providers.calendar), mailCheck = providers.mail.checkConnection.bind(providers.mail);
  providers.calendar.checkDestination = async (...args) => {
    const result = await destination(...args);
    const incapable = await env.DB.prepare("SELECT failure FROM fixture_controls WHERE kind = 'conference_capability'").first<{ failure: number }>();
    return { ...result, conferenceCapable: !incapable?.failure };
  };
  providers.mail.checkConnection = async () => {
    await env.DB.prepare("INSERT INTO fixture_activity(kind, happened_at) VALUES ('mail_check', ?)").bind(new Date().toISOString()).run();
    const control = await env.DB.prepare("SELECT failure FROM fixture_controls WHERE kind = 'mail_check'").first<{ failure: number }>();
    const barrier = await env.DB.prepare("SELECT armed FROM fixture_authoring_barrier WHERE id = 1").first<{ armed: number }>();
    if (barrier?.armed) {
      await env.DB.prepare("UPDATE fixture_authoring_barrier SET entered = 1 WHERE id = 1").run();
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const state = await env.DB.prepare("SELECT armed FROM fixture_authoring_barrier WHERE id = 1").first<{ armed: number }>();
        if (!state?.armed) break;
        await new Promise((done) => setTimeout(done, 25));
      }
      if (Date.now() >= deadline) throw new Error("Task-owned publication probe barrier timed out");
    }
    if (control?.failure) throw new ProviderFailure("provider_unavailable", false);
    return mailCheck();
  };
  providers.calendar.readBusy = async (token, input) => {
    const result = await readBusy(token, input);
    const row = await env.DB.prepare("SELECT intervals_json AS intervals FROM fixture_diagnostics_busy WHERE id = 1").first<{ intervals: string }>();
    const extra = row ? JSON.parse(row.intervals) as SyntheticBusy[] : [];
    return { ...result, intervals: [...result.intervals, ...extra.map((interval) => ({ ...interval, calendarId: input.calendarIds[0], startsAt: interval.startAt, endsAt: interval.endAt, deleted: false, transparency: "opaque" as const }))] };
  };
  const runtime = parseRuntimeEnvironment(env), documents = { fetch: (request: Request) => start.fetch(request) } as Fetcher;
  const services = createServices(env.DB, runtime, documents, { ...providers, calendarChanges: coordinatedCalendarChanges(env) });
  return services;
}
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    if (["/__fixtures/setup", "/__fixtures/profile-setup"].includes(url.pathname) && request.method === "POST") {
      if (url.pathname === "/__fixtures/profile-setup" && await env.DB.prepare("SELECT id FROM host_profiles LIMIT 1").first()) return new Response("Profile setup requires fresh task-owned state", { status: 409 });
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_diagnostics_busy (id INTEGER PRIMARY KEY CHECK(id = 1), intervals_json TEXT NOT NULL)").run();
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS fixture_authoring_barrier (id INTEGER PRIMARY KEY CHECK(id = 1), armed INTEGER NOT NULL, entered INTEGER NOT NULL)").run();
      const services = servicesFor(env), fixture = await setup(env, services), profile = await services.hostProfile.getProfile();
      if (!profile) throw new Error("Synthetic profile setup failed");
      await services.hostProfile.saveProfile({ ...profile, timezone: "UTC" });
      if (url.pathname === "/__fixtures/profile-setup") {
        if (await env.DB.prepare("SELECT id FROM bookings LIMIT 1").first()) throw new Error("Blank profile setup cannot erase a populated booking fixture");
        await env.DB.prepare("DELETE FROM host_profiles").run();
      }
      return Response.json(fixture);
    }
    if (url.pathname === "/__fixtures/authoring/barrier") {
      if (request.method === "POST") {
        const input = await request.json<{ armed: boolean }>();
        await env.DB.prepare("INSERT INTO fixture_authoring_barrier VALUES (1, ?, 0) ON CONFLICT(id) DO UPDATE SET armed = excluded.armed, entered = 0").bind(input.armed ? 1 : 0).run();
        return new Response(null, { status: 204 });
      }
      return Response.json(await env.DB.prepare("SELECT * FROM fixture_authoring_barrier WHERE id = 1").first());
    }
    if (url.pathname === "/__fixtures/diagnostics/busy" && request.method === "POST") {
      const input = await request.json<{ intervals: SyntheticBusy[] }>();
      await env.DB.prepare("INSERT INTO fixture_diagnostics_busy (id, intervals_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET intervals_json = excluded.intervals_json").bind(JSON.stringify(input.intervals)).run();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/__fixtures/diagnostics/state" && request.method === "GET") {
      const state = await status(env.DB);
      for (const table of ["host_profiles", "profile_focus_areas", "social_proof_entries", "event_types", "event_questions", "recurring_availability_windows", "availability_date_overrides", "availability_date_override_windows", "operator_creation_receipts", "operator_creation_tombstones"]) state[table] = (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
      return Response.json(state);
    }
    return url.pathname.startsWith("/__fixtures/") ? handleFixtures(request, env, servicesFor) : production.fetch(request, env, context);
  },
};
