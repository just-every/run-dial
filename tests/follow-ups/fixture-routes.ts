import type { AppBindings } from "../../src/core/app/bindings";
import type { AppServices } from "../../src/core/app/services";
/** Task-only data and clock controls; every send uses the product dispatcher. */
export async function followUpFixtures(request: Request, env: AppBindings, services: AppServices, messages: Record<string, unknown>[] = []) {
  const path = new URL(request.url).pathname;
  if (path === "/__fixtures/follow-ups/facts") return Response.json({ messages, runs: (await env.DB.prepare("SELECT id,booking_id AS bookingId,occurrence_id AS occurrenceId,due_at AS dueAt,state,reason,outbox_id AS outboxId FROM follow_up_runs").all()).results, outbox: (await env.DB.prepare("SELECT id,booking_id AS bookingId,state,json_extract(payload_json,'$.messageKind') AS kind FROM delivery_outbox").all()).results });
  if (path === "/__fixtures/follow-ups/end") { const { bookingId } = await request.json<{ bookingId: string }>(); await env.DB.prepare("UPDATE booking_occurrences SET start_at=?,end_at=? WHERE booking_id=? AND is_current=1").bind(new Date(Date.now() - 2 * 3600000).toISOString(), new Date(Date.now() - 3600000).toISOString(), bookingId).run(); return new Response(null, { status: 204 }); }
  if (path === "/__fixtures/follow-ups/tick") { const { now } = await request.json<{ now: string }>(); return Response.json(await services.followUps.tick(now)); }
  if (path === "/__fixtures/follow-ups/deliver") { const { now } = await request.json<{ now: string }>(); return Response.json(await services.delivery.processDue(100, new Date(now))); }
}
