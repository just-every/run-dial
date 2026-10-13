import start from "@tanstack/react-start/server-entry";
import { z } from "zod";
import { createWorker } from "../../src/core/app/worker";
import { BookingCoordinator as ProductionCoordinator } from "../../src/core/app/booking-coordinator";
import { createServices } from "../../src/core/app/services";
import { coordinatedCalendarChanges } from "../../src/core/app/booking-coordination";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { fixtureProviders, isolatedProviderDb } from "../review/providers";
import { handleFixtures } from "../review/fixture-routes";

function servicesFor(env: AppBindings) {
  const providerDb = isolatedProviderDb(env);
  const providers = fixtureProviders(providerDb);
  const ordinaryBusy = providers.calendar.readBusy;
  providers.calendar.readBusy = async (...args) => {
    const entered = await providerDb.prepare("UPDATE fixture_blocking_barrier SET state = 'entered' WHERE id = 'busy' AND state = 'armed'").run();
    if (entered.meta.changes === 1) {
      for (let attempt = 0; ; attempt++) {
        const current = await providerDb.prepare("SELECT state FROM fixture_blocking_barrier WHERE id = 'busy'").first<{ state: string }>();
        if (current?.state === "released") break;
        if (attempt >= 400) throw new Error("The synthetic blocking verification barrier was not released within10seconds");
        await new Promise((done) => setTimeout(done, 25));
      }
    }
    return ordinaryBusy(...args);
  };
  return createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { ...providers, calendarChanges: coordinatedCalendarChanges(env) });
}
export class BookingCoordinator extends ProductionCoordinator { protected services(env: AppBindings) { return servicesFor(env); } }
const production = createWorker(servicesFor);
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response("Not found", { status: 404 });
    const providerDb = isolatedProviderDb(env);
    await providerDb.prepare("CREATE TABLE IF NOT EXISTS fixture_blocking_barrier (id TEXT PRIMARY KEY CHECK(id = 'busy'), state TEXT NOT NULL CHECK(state IN ('armed','entered','released')))").run();
    if (url.pathname === "/__fixtures/blocking/barrier") {
      if (request.method === "POST") {
        const input = z.object({ state: z.enum(["armed", "released"]) }).strict().parse(await request.json());
        await providerDb.prepare("INSERT INTO fixture_blocking_barrier (id,state) VALUES ('busy',?) ON CONFLICT(id) DO UPDATE SET state = excluded.state").bind(input.state).run();
      } else if (request.method !== "GET") return new Response("Not found", { status: 404 });
      return Response.json(await providerDb.prepare("SELECT state FROM fixture_blocking_barrier WHERE id = 'busy'").first() ?? { state: "released" });
    }
    return url.pathname.startsWith("/__fixtures/") ? handleFixtures(request, env, servicesFor) : production.fetch(request, env, context);
  },
};
