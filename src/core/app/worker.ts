// Demo mode's guard comes first, so no later module can keep the real fetch; it does nothing without RER_DEMO=1.
import { withDemo } from "../../modules/demo/index.mjs";
import { enterApplication, withApplication, ArchiveMaintenance, maintenanceResponse } from "../features/portability/admission";
import { hostedExport } from "../features/portability/routes";
import { staticAssetResponse } from "../../base/static-assets";
import { setupStateResponse, claimedWhen } from "../../base/setup-state";
import { lobbyResponse } from "../../base/lobby";
import { identity } from "../../identity";
import { ownerClaim } from "../features/operators/owner-claim.server";
import { handleDevelopmentOutbox } from "../platform/mail/development";
import { createApp } from "./hono";
import type { AppBindings } from "./bindings";
import { createServices, type AppServices } from "./services";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { fetchBuildAsset } from "../platform/build-assets";
import { isThemeFile } from "../platform/theme-files";
import { isPrivateLocalPath } from "../platform/private-local-path";
import { PublicAdmissionGate, PublicAdmissionError, admissionErrorResponse, admissionResponse, isAuthenticatedCallbackPath, requiresPublicAdmission } from "../platform/public-admission";

import start from "@tanstack/react-start/server-entry";
import { seedDemo } from "../../demo";

export { BookingCoordinator } from "./booking-coordinator";
import { bookingMutationTarget, forwardBookingRequest, coordinatedCalendarChanges } from "./booking-coordination";
import { consumeJobs, runScheduledWork } from "./background-work";
import { connectionWatchObservers } from "./connection-watch";

const claimed = claimedWhen("SELECT 1 FROM operator_setup_identity WHERE singleton_key='default' AND onboarding_completed_at IS NOT NULL LIMIT 1");

export function createWorker(servicesFactory?: (env: AppBindings) => AppServices) {
const servicesFor = servicesFactory ?? ((env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { files: env.FILES, calendarChanges: coordinatedCalendarChanges(env), connectionWatch: connectionWatchObservers(env) }));
const app = createApp({ fetch: async (request) => start.fetch(request) }, servicesFor);

const worker = {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    // Setup reaches this Worker directly. Reject private namespaces before the
    // document router can canonicalize a directory URL into a redirect.
    if (isPrivateLocalPath(url.pathname)) return new Response("Not found", { status: 404 });
    const runtime = parseRuntimeEnvironment(env);
    if (url.host !== new URL(runtime.APP_URL).host || (request.headers.has("host") && request.headers.get("host") !== new URL(runtime.APP_URL).host)) return new Response("Not found", { status: 404 });
    if (url.pathname === "/auth/owner-claim") return (await ownerClaim(env.DB, runtime, request)) ?? new Response("Not found", { status: 404 });
    if (url.pathname === "/__dev/key" || url.pathname === "/__dev/outbox" || url.pathname.startsWith("/__dev/outbox/")) return (await handleDevelopmentOutbox(request, env.DB, runtime, env.RER_DEV_KEY)) ?? new Response("Not found", { status: 404 });
    // General app build assets spend the native public budget before dispatch below.
    const asset = url.pathname.startsWith("/assets/") ? null : await staticAssetResponse(request, env); if (asset) return asset;
    const lobbyBindings = { DB: env.DB, AUTH_ORIGIN: runtime.APP_URL };
    const state = await setupStateResponse(request, lobbyBindings, claimed); if (state) return state;
    const lobby = await lobbyResponse(request, lobbyBindings, identity, claimed); if (lobby) return lobby;
    if (requiresPublicAdmission(url.pathname) && !isAuthenticatedCallbackPath(request)) {
      try {
        const refusal = admissionResponse(await new PublicAdmissionGate(env.DB, runtime).admit(request));
        if (refusal) return refusal;
      } catch (error) { if (error instanceof PublicAdmissionError) return admissionErrorResponse(error); throw error; }
    }
    // Preserve the actual request method, cookies, Host and Origin inside the shared gate.
    if ((url.pathname === "/api/app/operators" || /^\/api\/app\/operators\/[^/]+\/remove$/.test(url.pathname)) && request.method === "POST") {
      return forwardBookingRequest(env, "operator-notifications", request);
    }
    const bookingId = await bookingMutationTarget(request, env);
    if (bookingId) return forwardBookingRequest(env, bookingId, request);
    if (url.pathname.startsWith("/_serverFn/")) return start.fetch(request);
    if (url.pathname.startsWith("/assets/")) return fetchBuildAsset(request, env.ASSETS);
    if (url.pathname === "/media" || url.pathname.startsWith("/media/")) return request.method === "GET" ? app.fetch(request, env, context) : new Response("Not found", { status: 404 });
    if (isThemeFile(request)) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith("/auth/") || url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/" || /^\/(app|setup|book|manage|embed)(\/|$)/.test(url.pathname) || ["/signin", "/privacy"].includes(url.pathname)) return app.fetch(request, env, context);
    return request.method === "GET" ? start.fetch(request) : new Response("Not found", { status: 404 });
  },
  async queue(batch: MessageBatch<unknown>, env: AppBindings) {
    await consumeJobs(batch, env, servicesFor(env));
  },
  async scheduled(_controller: ScheduledController, env: AppBindings) {
    await runScheduledWork(env, servicesFor(env));
  },
} satisfies ExportedHandler<AppBindings>;
return {
 ...worker,
 fetch(request: Request, env: AppBindings, context: ExecutionContext) {
  const operation = (async () => {
   if (new URL(request.url).pathname.startsWith("/api/portability/")) return hostedExport(request, env, servicesFor(env).operators);
   let leave: (() => Promise<void>) | undefined;
   const pending: Promise<unknown>[] = [];
   try {
    leave = await enterApplication(env.DB);
    return await worker.fetch(request, env, { waitUntil(work: Promise<unknown>) { pending.push(work); }, passThroughOnException() { context.passThroughOnException(); } } as ExecutionContext);
   } catch (error) { if (error instanceof ArchiveMaintenance) return maintenanceResponse(); throw error; }
   finally { if (leave) { await Promise.allSettled(pending); await leave(); } }
  })();
  // Client disconnects can cancel an awaited fetch before its finally runs.
  // Keep admission, application work and receipt cleanup in the runtime's
  // post-disconnect lifetime; never release admission while work is pending.
  context.waitUntil(operation);
  return operation;
 },
 async queue(batch: MessageBatch<unknown>, env: AppBindings) {
  try { await withApplication(env.DB, () => worker.queue(batch, env)); }
  catch (error) { if (error instanceof ArchiveMaintenance) { batch.retryAll({ delaySeconds: 30 }); return; } throw error; }
 },
 async scheduled(controller: ScheduledController, env: AppBindings) {
  try { await withApplication(env.DB, () => worker.scheduled(controller, env)); }
  catch (error) { if (!(error instanceof ArchiveMaintenance)) throw error; }
 },
} satisfies ExportedHandler<AppBindings>;

}

export default withDemo(createWorker(), { seed: seedDemo });
