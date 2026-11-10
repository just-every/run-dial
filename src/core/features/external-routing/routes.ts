import { Hono, type Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { externalRoutingBootstrap } from "./bootstrap";
import { handoffDocument, handoffScript, handoffStyles } from "./handoff";

const secured = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const asset = (context: Context<AppEnvironment>, type: string, body: string, cache: string) =>
  context.body(body, 200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": cache, ...secured });

/** Public, session-free documents under the existing /api/public/ admission. The routing and booking doors are reused as they are. */
export const externalRoutingRoutes = new Hono<AppEnvironment>()
  .get("/api/public/external-routing/dial-form.js", (context) => asset(context, "application/javascript", externalRoutingBootstrap, "public, max-age=300"))
  .get("/api/public/external-routing/handoff.js", (context) => asset(context, "application/javascript", handoffScript, "public, max-age=300"))
  .get("/api/public/external-routing/handoff.css", (context) => asset(context, "text/css", handoffStyles, "public, max-age=300"))
  .get("/api/public/external-routing/handoff", (context) => context.html(handoffDocument, 200, {
    ...secured,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }));
