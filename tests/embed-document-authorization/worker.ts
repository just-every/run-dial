import production, { BookingCoordinator } from "../ux-simplification/worker";
import { readPublicDocument } from "../../src/core/app/documents.server";
import { createServices } from "../../src/core/app/services";
import type { AppBindings } from "../../src/core/app/bindings";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import { EventTypesRepository } from "../../src/core/features/event-types";

export { BookingCoordinator };
export default {
  ...production,
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname !== "127.0.0.1") return new Response(null, { status: 404 });
    if (request.method === "POST" && url.pathname === "/__fixtures/embed-document") {
      const { path } = await request.json<{ path: string }>();
      return Response.json(await readPublicDocument(path));
    }
    if (request.method === "POST" && url.pathname === "/__fixtures/embed-rotate") {
      const booking = await env.DB.prepare("SELECT id FROM bookings LIMIT 1").first<{ id: string }>();
      if (!booking) return new Response(null, { status: 404 });
      const services = createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS);
      return Response.json(await services.bookings.rotateManageTokenForOperator(booking.id));
    }
    if (request.method === "POST" && url.pathname === "/__fixtures/embed-state") {
      const { status, allowedOrigins, requestOnly } = await request.json<{ status?: "draft" | "disabled" | "published"; allowedOrigins?: string[]; requestOnly?: boolean }>();
      const services = createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS);
      if (allowedOrigins) await services.embeds.replaceAllowedOrigins(allowedOrigins);
      const events = new EventTypesRepository(env.DB);
      const event = await events.getBySlug("intro");
      if (!event) return new Response(null, { status: 404 });
      if (status) await events.setStatus(event.id, status);
      if (requestOnly !== undefined) await env.DB.prepare("UPDATE event_types SET request_only = ? WHERE id = ?").bind(requestOnly ? 1 : 0, event.id).run();
      return new Response(null, { status: 204 });
    }
    return production.fetch(request, env, context);
  },
};
