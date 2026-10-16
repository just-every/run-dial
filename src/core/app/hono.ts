import { personErasureRoutes } from "../features/erasure/person-routes";
import { ArchiveMaintenance, maintenanceResponse } from "../features/portability/admission";
import { ErasureError } from "../../modules/erasure/index.mjs";
import { extensionRoutes } from "./mount.server";
import { avatarRoutes } from "../features/host-profile/avatar-routes";
import { editorConfigResponse, editorDocument } from "../features/editor/editor.server";
import { moveInRoutes } from "../features/move-in/routes";
import { hostSetupRoutes } from "../features/host-setup/routes";
import { availabilityDiagnosticRoutes } from "../features/availability/routes";
import { erasureRoutes } from "../features/erasure";
import { Hono, type Context, type Next, type ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { availabilityRequestRoutes } from "../features/availability-requests";
import { bookingOperatorRoutes } from "../features/bookings";
import { calendarConnectionRoutes } from "../features/calendar-connection";
import { deliveryRoutes } from "../features/delivery";
import { embedRoutes } from "../features/embeds";
import { eventTypeRoutes } from "../features/event-types/routes";
import { hostProfileRoutes } from "../features/host-profile/routes";
import { operatorManagementRoutes } from "../features/operators/management-routes";
import { AuthError } from "../features/operators/service";
import { operatorRoutes } from "../features/operators/routes";
import { publicBookingRoutes } from "../features/public-booking/routes";
import { checkPlatformBindings } from "../platform/health";
import { apiError, discardRequestBody } from "../shared/http";
import { RuntimeConfigurationError, parseRuntimeEnvironment } from "../shared/runtime-env";
import type { AppEnvironment } from "./context";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import { createServices } from "./services";
import { PublicAdmissionGate, PublicAdmissionError, admissionErrorResponse, type Admission, type CallbackProvider } from "../platform/public-admission";
import { publicAbuseRoutes } from "../features/public-abuse";

/** Compose typed sub-apps so AppType retains the complete Hono RPC schema. */
export function createApp(documents?: { fetch(request: Request): Promise<Response> }, servicesFactory?: (env: AppBindings) => AppServices, admitProvider?: (request: Request, env: AppBindings, provider: CallbackProvider) => Promise<Admission>) {
  const base = new Hono<AppEnvironment>()
    .use("*", async (context, next) => {
      const runtime = parseRuntimeEnvironment(context.env);
      const services = servicesFactory ? servicesFactory(context.env) : createServices(context.env.DB, runtime, (documents ?? context.env.ASSETS) as Fetcher, { files: context.env.FILES });
      const origin = context.req.header("Origin");
      if (["POST", "PATCH", "PUT", "DELETE"].includes(context.req.method) && origin && origin !== new URL(runtime.APP_URL).origin && !context.req.path.startsWith("/api/webhooks/")) return apiError(context, 403, "origin_not_allowed", "Use the deployment origin for this action.");
      context.set("runtime", runtime);
      context.set("services", services);
      context.set("admitProvider", (provider) => admitProvider ? admitProvider(context.req.raw, context.env, provider) : new PublicAdmissionGate(context.env.DB, runtime).admit(context.req.raw, provider));

      await next();
      if (context.req.path === "/app" || context.req.path.startsWith("/app/")) context.res = editorDocument(context.res, runtime);
      if (["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method) && context.res.status < 400 && !context.req.path.startsWith("/api/app/move-in/") && !context.get("inertMutation")) {
        context.executionCtx.waitUntil(services.delivery.enqueueDue(context.env.JOBS));
      }
    })
    .all("/auth/*", async (context) => (await context.get("services").operators.handle(context.req.raw)) ?? context.notFound())
    .all("/api/editor/config", (context) => editorConfigResponse(context.get("runtime"), context.get("services").operators, context.req.raw))
    .get("/health", async (context) => {
      const result = await checkPlatformBindings({ database: context.env.DB, files: context.env.FILES, jobs: context.env.JOBS });
      const identity = context.env.RER_DEPLOY_SOURCE && context.env.RER_DEPLOY_FINGERPRINT && context.env.RER_VERSION?.id
        ? { deployment: { sourceSha: context.env.RER_DEPLOY_SOURCE, fingerprint: context.env.RER_DEPLOY_FINGERPRINT, versionId: context.env.RER_VERSION.id } } : {};
      return context.json({ ...result, ok: result.status === "ok", ...identity }, result.status === "ok" ? 200 : 503);
    })
    .use("/api/app/*", requireSession)
    .use("/app", requireSession)
    .use("/app/*", requireSession)
    .use("/setup", requireSession)
    .use("/setup/*", requireSession);

  const app = base
    .get("/api/app/platform-health", async (context) => {
      const health = await checkPlatformBindings({ database: context.env.DB, files: context.env.FILES, jobs: context.env.JOBS });
      return context.json({ ...health, checkedAt: new Date().toISOString() });
    })
    .route("/", extensionRoutes)
    .route("/", operatorRoutes)
    .route("/", operatorManagementRoutes)
    .route("/", publicAbuseRoutes)
    .route("/", bookingOperatorRoutes)
    .route("/", hostProfileRoutes)
    .route("/", avatarRoutes)
    .route("/", eventTypeRoutes)
    .route("/", hostSetupRoutes)
    .route("/", availabilityDiagnosticRoutes)
    .route("/", availabilityRequestRoutes)
    .route("/", calendarConnectionRoutes)
    .route("/", deliveryRoutes)
    .route("/", erasureRoutes)
    .route("/", personErasureRoutes)
    .route("/", moveInRoutes)
    .route("/", embedRoutes)
    .route("/", publicBookingRoutes)
    .get("/", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw))
    .get("/app", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw))
    .get("/app/*", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw))
    .get("/setup", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw))
    .get("/setup/*", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw))
    .get("/signin", (context) => (documents ?? context.env.ASSETS).fetch(context.req.raw));

  app.onError(appError);
  return app;
}

/** Keep native error envelopes identical for HTTP and private document reads. */
export const appError: ErrorHandler<AppEnvironment> = (error, context) => {
    if (error instanceof ArchiveMaintenance) return maintenanceResponse();
    if (error instanceof ErasureError) return apiError(context, error.status as 400, error.code, error.code === "native_session_required" ? "Sign in with your operator sign-in link to erase personal data." : error.code === "erasure_preview_changed" ? "The preview expired or matching records changed. Preview again before confirming." : error.code === "erasure_import_value_too_long" ? "A saved value for this person inside another person's imported booking is longer than 4,096 characters and cannot be matched exactly; no completed erasure receipt was issued." : "Erasure could not complete. Preview the email again to resume; no completed receipt was issued.");
    if (error instanceof AuthError) return context.json({ error: { code: error.code, message: error.code === "last_owner" ? "The last operator cannot be removed." : error.code === "operator_identity_overlap" ? "This operator also has bookings or requests. Use Erase personal data in Settings to erase every matching invitee record, then remove the operator separately." : "Operator access could not be changed. Reload and try again." } }, error.status as 400);
    if (error instanceof PublicAdmissionError) return admissionErrorResponse(error);
    if (error instanceof RuntimeConfigurationError) return apiError(context, 503, "configuration_missing", error.message);
    // Hono rejects malformed JSON before the validation hook can build an envelope.
    // Honor its explicit client status without exposing exception messages or bodies.
    if (error instanceof HTTPException && error.status === 400) return apiError(context, 400, "invalid_request", "The request contains invalid fields.");
    console.error("runtime_unavailable");
    return apiError(context, 503, "runtime_unavailable", "The Worker could not process this request.");
};

export type AppType = ReturnType<typeof createApp>;

async function requireSession(context: Context<AppEnvironment>, next: Next) {
  const session = await context.get("services").operators.authenticate(context.req.raw);
  const document = /^\/(app|setup)(\/|$)/.test(context.req.path);
  if (!session) {
    if (document) {
      const target = new URL("/signin", context.req.url);
      target.searchParams.set("next", `${context.req.path}${new URL(context.req.url).search}`);
      return context.redirect(target.pathname + target.search, 302);
    }
    await discardRequestBody(context.req.raw);
    return apiError(context, 401, "session_required", "A valid operator session is required.");
  }
  if (document) {
    const completed = await context.get("services").hostSetup.completion();
    const setup = /^\/setup(\/|$)/.test(context.req.path);
    if (!completed && !setup) return context.redirect("/setup", 302);
    if (completed && setup) return context.redirect("/app", 302);
  }
  context.set("session", session);
  await next();
}
