import { dialAgentDoor } from "../../agent-door/index.server";
import { operatorNotificationCommand } from "../platform/operator-notification-boundary";
import { withPrivateRequest, privateRequestServices, nativeRequestSession, privateReadTasks, deferPrivateRead } from "./private-request.server";
// Demo mode's guard comes first, so no later module can keep the real fetch; it does nothing without RER_DEMO=1.
import { withDemo } from "../../../modules/demo/index.mjs";
import { withApplication, ArchiveMaintenance } from "../features/portability/admission";
import { applicationRequest } from "../features/portability/request";
import { hostedExport } from "../features/portability/routes";
import { staticAssetResponse } from "../../base/static-assets";
import { setupStateResponse, claimedWhen } from "../../base/setup-state";
import { lobbyResponse } from "../../base/lobby";
import { openSessionHome, plainAddressRedirect } from "./app-entry-redirects";
import { identity } from "../../identity";
import { ownerClaim } from "../features/operators/owner-claim.server";
import { createApp } from "./hono";
import type { AppBindings } from "./bindings";
import { createServices, type AppServices } from "./services";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { localRuntimeBindings } from "../shared/local-runtime-bindings";
import { fetchBuildAsset } from "../platform/build-assets";
import { isThemeFile } from "../platform/theme-files";
import { isPrivateLocalPath } from "../platform/private-local-path";
import { PublicAdmissionGate, PublicAdmissionError, admissionErrorResponse, admissionResponse, isAuthenticatedCallbackPath, requiresPublicAdmission } from "../platform/public-admission";

import start from "./start.server";
import favicon from "../features/public-booking/ui/favicon.svg?raw";
import { seedDemo } from "../../demo";

export { BookingCoordinator } from "./booking-coordinator";
import { bookingMutationTarget, forwardBookingRequest, coordinatedCalendarChanges } from "./booking-coordination";
import { consumeJobs, runScheduledWork } from "./background-work";
import { connectionWatchObservers } from "./connection-watch";

const claimed = claimedWhen("SELECT 1 FROM operator_setup_identity WHERE singleton_key='default' AND onboarding_completed_at IS NOT NULL LIMIT 1");

export function createWorker(servicesFactory?: (env: AppBindings) => AppServices) {
const newServicesFor = servicesFactory ?? ((env: AppBindings) => createServices(env.DB, parseRuntimeEnvironment(env), { fetch: (request: Request) => start.fetch(request) } as Fetcher, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), files: env.FILES, calendarChanges: coordinatedCalendarChanges(env), connectionWatch: connectionWatchObservers(env) }));
const servicesFor = (env: AppBindings) => privateRequestServices(env) ?? newServicesFor(env);
const app = createApp({ fetch: async (request) => start.fetch(request) }, servicesFor);

const worker = {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    const runtime = parseRuntimeEnvironment(env);
    if (url.pathname === "/auth/owner-claim") return (await ownerClaim(env.DB, runtime, request)) ?? new Response("Not found", { status: 404 });
    // Preserve the actual request method, cookies, Host and Origin inside the shared gate.
    if ((url.pathname === "/api/app/operators" || /^\/api\/app\/operators\/[^/]+\/remove$/.test(url.pathname)) && request.method === "POST") {
      return forwardBookingRequest(env, "operator-notifications", request);
    }
    const bookingId = await bookingMutationTarget(request, env);
    if (bookingId) return forwardBookingRequest(env, bookingId, request);
    if (url.pathname.startsWith("/_serverFn/")) return start.fetch(request);
    if (url.pathname === "/media" || url.pathname.startsWith("/media/")) return request.method === "GET" ? app.fetch(request, env, context) : new Response("Not found", { status: 404 });
    if (isThemeFile(request)) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith("/auth/") || url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname === "/health" || url.pathname === "/" || /^\/(app|setup|book|manage|embed|poll)(\/|$)/.test(url.pathname) || ["/signin", "/privacy"].includes(url.pathname)) return app.fetch(request, env, context);
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
  env = localRuntimeBindings(env);
  const run = () => applicationRequest(env.DB, context, async (admit, tracked) => {
   const url = new URL(request.url);
   if (isPrivateLocalPath(url.pathname)) return new Response("Not found", { status: 404 });
   const runtime = parseRuntimeEnvironment(env);
   if (url.host !== new URL(runtime.APP_URL).host || (request.headers.has("host") && request.headers.get("host") !== new URL(runtime.APP_URL).host)) return new Response("Not found", { status: 404 });
   // Browsers ask for this path on documents with no icon link (the sign-in confirmation); answer with Dial's own icon.
   if (url.pathname === "/favicon.ico" && (request.method === "GET" || request.method === "HEAD")) return new Response(favicon, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
   if (url.pathname.startsWith("/api/portability/")) return hostedExport(request, env, servicesFor(env).operators);
   const asset = url.pathname.startsWith("/assets/") ? null : await staticAssetResponse(request, env); if (asset) return asset;
   // Agent transport authenticates itself before native app setup/session redirects.
   // Archive admission still fences its synchronous effects and retained evidence.
   if (url.pathname === "/mcp" || url.pathname === "/agents" || url.pathname.startsWith("/agents/") || url.pathname === "/api/rer/agent-policy" || url.pathname === "/api/rer/business-settings" || url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    await admit();
    const response = await dialAgentDoor(env, runtime, servicesFor(env)).handle(request);
    if (response) return response;
   }
   const lobbyBindings = { DB: env.DB, AUTH_ORIGIN: runtime.APP_URL };
   const state = await setupStateResponse(request, lobbyBindings, claimed); if (state) return state;
   const plain = plainAddressRedirect(request); if (plain) return plain;
   const home = await openSessionHome(request, () => nativeRequestSession(request, servicesFor(env).operators.auth)); if (home) return home;
   const lobby = await lobbyResponse(request, lobbyBindings, identity, claimed); if (lobby) return lobby;
   if (isAuthenticatedCallbackPath(request)) {
    // Provider handlers authenticate before calling this gate. Invalid callbacks
    // write nothing; accepted callbacks retain archive admission through effects.
    return createApp({ fetch: async (input) => start.fetch(input) }, servicesFor, async (input, bindings, provider) => {
     const admission = await new PublicAdmissionGate(bindings.DB, runtime).admit(input, provider);
     if (admission.kind === "admitted") await admit();
     return admission;
    }).fetch(request, env, tracked);
   }
   const publicAdmission = requiresPublicAdmission(url.pathname);
   const session = publicAdmission ? null : await nativeRequestSession(request, servicesFor(env).operators.auth);
   if (publicAdmission || !session) {
    try {
     const refusal = admissionResponse(await new PublicAdmissionGate(env.DB, runtime).admit(request));
     if (refusal) return refusal;
    } catch (error) { if (error instanceof PublicAdmissionError) return admissionErrorResponse(error); throw error; }
   }
   if (url.pathname.startsWith("/assets/")) return fetchBuildAsset(request, env.ASSETS);
   await admit();
   if (request.method === "GET" && session && /^\/app(\/|$)/.test(url.pathname)) {
    const services = servicesFor(env);
    // These independent fresh reads need no setup result. Keep authentication
    // and archive admission ahead of them, then overlap the setup check.
    deferPrivateRead(services.hostProfile.getProfile());
    const eventId = /^\/app\/event-types\/([0-9A-Z]{26})$/.exec(url.pathname)?.[1];
    if (eventId) deferPrivateRead(services.eventTypes.getEventType(eventId));
   }
   return worker.fetch(request, env, tracked);
  }, privateReadTasks, request.method === "GET");
  return /^\/(app|setup|_serverFn)(\/|$)/.test(new URL(request.url).pathname)
   ? withPrivateRequest(request, env, newServicesFor(env), run)
   : run();
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
