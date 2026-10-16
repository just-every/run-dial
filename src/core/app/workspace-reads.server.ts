import { appError } from "./hono";
import { deferPrivateRead } from "./private-request.server";
import { Hono } from "hono";
import type { AppEnvironment } from "./context";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import type { RuntimeEnvironment } from "../shared/runtime-env";
import type { SessionRecord } from "../features/operators/repository";
import { eventTypeRoutes } from "../features/event-types/routes";
import { bookingOperatorRoutes } from "../features/bookings/routes";
import { availabilityRequestRoutes } from "../features/availability-requests/routes";
import { hostProfileRoutes } from "../features/host-profile/routes";
import { hostSetupRoutes } from "../features/host-setup/routes";
import { deliveryRoutes } from "../features/delivery/routes";
import { calendarConnectionRoutes } from "../features/calendar-connection/routes";
import { operatorManagementRoutes } from "../features/operators/management-routes";
import { embedRoutes } from "../features/embeds/routes";
import { publicAbuseRoutes } from "../features/public-abuse/routes";
import { moveInRoutes } from "../features/move-in/routes";
import { extensionRoutes } from "./mount.server";
import { checkPlatformBindings } from "../platform/health";
import { archiveStatus } from "../features/portability/admission";
import { bookingListQuery, readBookingFilters, readBookingPage } from "../features/bookings/ui/booking-filters";
import { readKey, type WorkspaceReads, type WorkspaceRead } from "./workspace-reads";

/** Called only after the document/server function independently validates its native session. */
export async function readWorkspaceReads(path: string, request: Request, bound: AppBindings, runtime: RuntimeEnvironment, services: AppServices, operator: SessionRecord, canInspectArchive: boolean) {
  // This internal router reuses the native GET handlers, validation and errors.
  // Its fixed read inventory is never supplied by the caller and is never served as an HTTP surface.
  const app = new Hono<AppEnvironment>().use("*", async (context, next) => {
    context.set("services", services); context.set("runtime", runtime); context.set("session", operator);
    await next();
  }).get("/api/app/session", context => context.json({ operator }))
    .get("/api/app/platform-health", async context => context.json({ ...await checkPlatformBindings({ database: bound.DB, files: bound.FILES, jobs: bound.JOBS }), checkedAt: new Date().toISOString() }))
    .route("/", hostProfileRoutes).route("/", hostSetupRoutes).route("/", eventTypeRoutes)
    .route("/", bookingOperatorRoutes).route("/", availabilityRequestRoutes).route("/", deliveryRoutes)
    .route("/", calendarConnectionRoutes).route("/", operatorManagementRoutes).route("/", embedRoutes)
    .route("/", publicAbuseRoutes).route("/", moveInRoutes).route("/", extensionRoutes);
  app.onError(appError);
  const reads: WorkspaceReads = {};
  const jobs = new Map<string, Promise<void>>();
  const read = (endpoint: string) => {
    const key = readKey(endpoint);
    let job = jobs.get(key);
    if (!job) {
      job = (async () => {
        const response = await app.fetch(new Request(new URL(endpoint, runtime.APP_URL), { headers: request.headers }), bound);
        reads[key] = { body: await response.text(), status: response.status, headers: Object.fromEntries(response.headers) };
      })();
      jobs.set(key, job);
    }
    return job;
  };
  const url = new URL(path, runtime.APP_URL);
  const routes = ["/api/app/profile", "/api/app/host-setup"];
  const name = url.pathname;
  if (["/app", "/app/", "/app/event-types", "/app/availability", "/app/bookings", "/app/bookings/new", "/app/settings"].includes(name)) routes.push("/api/app/event-types");
  if (name === "/app" || name === "/app/") {
    routes.push("/api/app/bookings?order=created&limit=3", "/api/app/availability-requests");
    if (new URL(request.url).pathname.startsWith("/app")) routes.push("/api/app/platform-health");
  }
  if (name === "/app/requests") routes.push("/api/app/availability-requests?state=submitted");
  let bookingList: string | undefined;
  if (name === "/app/bookings") {
    bookingList = "/api/app/bookings?" + new URLSearchParams(bookingListQuery(readBookingFilters(url.search), readBookingPage(url.search)));
    routes.push(bookingList);
  }
  if (name === "/app/bookings/new" && url.searchParams.get("requestId")) routes.push("/api/app/availability-requests/" + encodeURIComponent(url.searchParams.get("requestId")!));
  const eventId = /^\/app\/event-types\/([0-9A-Z]{26})$/.exec(name)?.[1];
  if (eventId) {
    routes.push(`/api/app/event-types/${eventId}`, `/api/app/custom-fields/eventType/${eventId}`);
    const endpoint = `/api/app/event-types/${eventId}/readiness`;
    // Start streams this fresh result while the document's styles and scripts load.
    // The document stream remains open until the native provider check finishes.
    reads[endpoint] = deferPrivateRead(Promise.resolve(app.fetch(new Request(new URL(endpoint, runtime.APP_URL), { headers: request.headers }), bound)).then(async response => ({ body: await response.text(), status: response.status, headers: Object.fromEntries(response.headers) } satisfies WorkspaceRead)));
  }
  if (name === "/app/settings") routes.push(...["session", "calendar/connection", "calendar/setup", "mail/connection", "mail/preferences", "operators", "embed-settings", "blocked-addresses", "custom-fields", "move-in/jobs", "move-in/switch-over"].map(p => "/api/app/" + p));
  const work = routes.map(read);
  if (name === "/app/settings" && canInspectArchive) work.push(archiveStatus(bound.DB).then(status => { reads["/api/portability/status"] = { status: 200, body: JSON.stringify(status), headers: { "cache-control": "no-store", "content-type": "application/json" } }; }));
  if (bookingList) work.push(read(bookingList).then(async () => {
    const response = await reads[readKey(bookingList!)];
    if (response.status !== 200) return;
    const first = JSON.parse(response.body)[0] as { id: string; history: Array<{ actorType: string }> } | undefined;
    if (first) await Promise.all([read(`/api/app/bookings/${first.id}/deliveries`), read(`/api/app/custom-fields/booking/${first.id}`), ...(first.history.some(entry => entry.actorType === "operator") ? [read("/api/app/operators")] : [])]);
  }));
  await Promise.all(work);
  return reads;
}
