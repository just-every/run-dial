import { invitationBookingId } from "../features/bookings/invitation-capability";
import type { AppBindings } from "./bindings";
import { BookingsRepository, CalendarDeletionProbesRepository } from "../features/bookings";
import { hashToken } from "../platform/auth/tokens";
import { deliveryJobSchema } from "../features/delivery";
import type { CalendarExternalChange, CalendarExternalChangeHandler } from "../features/calendar-connection";
import { parseRuntimeEnvironment } from "../shared/runtime-env";

export async function bookingMutationTarget(request: Request, env: AppBindings) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return undefined;
  const path = new URL(request.url).pathname;
  if (/^\/api\/public\/book\/[^/]+\/[^/]+\/confirm$/.test(path) && request.method === "POST") {
    const body = await request.clone().json().catch(() => null) as { nonce?: unknown } | null;
    if (typeof body?.nonce === "string") return `nonce:${await hashToken(body.nonce, parseRuntimeEnvironment(env).SESSION_SECRET)}`;
  }
  if (path === "/api/app/bookings" && request.method === "POST") {
    const body = await request.clone().json().catch(() => null) as { requestId?: unknown } | null;
    if (typeof body?.requestId === "string") return `request:${body.requestId}`;
  }
  const annotation = /^\/api\/app\/custom-fields\/(booking|availabilityRequest)\/([^/]+)\//.exec(path);
  if (annotation) return annotation[1] === "booking" ? annotation[2] : `request:${annotation[2]}`;
  const requestTarget = /^\/api\/app\/availability-requests\/([^/]+)(?:\/|$)/.exec(path);
  if (requestTarget) return `request:${requestTarget[1]}`;
  const approval = /^\/api\/app\/booking-approvals\/([^/]+)\/decision$/.exec(path);
  if(approval)return (await env.DB.prepare("SELECT booking_id AS id FROM booking_approval_requests WHERE id=?").bind(approval[1]).first<{id:string}>())?.id;
  const operator = /^\/api\/app\/(?:bookings|erasures)\/([^/]+)(?:\/|$)/.exec(path);
  if (operator) return operator[1];
  // PAY-003: a balance link's Checkout is opened under its booking's coordinator, so two clicks share one session.
  const balance = /^\/api\/public\/payments\/balance\/([^/]+)$/.exec(path);
  if (balance) return (await env.DB.prepare("SELECT booking_id AS id FROM payment_link_tokens WHERE token_hash = ?").bind(await hashToken(balance[1], parseRuntimeEnvironment(env).SESSION_SECRET)).first<{ id: string }>())?.id;
  const invitation = /^\/api\/public\/manage\/invite\/([^/]+)\/email$/.exec(path);
  if (invitation) return invitationBookingId(invitation[1], parseRuntimeEnvironment(env));
  const capability = /^\/api\/public\/manage\/([^/]+)(?:\/|$)/.exec(path);
  if (!capability) return undefined;
  const hash = await hashToken(capability[1], parseRuntimeEnvironment(env).SESSION_SECRET);
  const token = await env.DB.prepare("SELECT booking_id AS id FROM booking_manage_tokens WHERE token_hash = ?").bind(hash).first<{ id: string }>();
  return token?.id;
}

export async function processCoordinatedDelivery(job: unknown, env: AppBindings, unlinked: () => Promise<unknown>) {
  const parsed = deliveryJobSchema.parse(job);
  const record = await env.DB.prepare("SELECT booking_id AS bookingId, request_id AS requestId FROM delivery_outbox WHERE id = ?").bind(parsed.outboxId).first<{ bookingId: string | null; requestId: string | null }>();
  const target = record?.bookingId ?? (record?.requestId ? `request:${record.requestId}` : undefined);
  if (!target) return unlinked();
  return forwardBookingRequest(env, target, new Request("http://coordinator.internal/__delivery", { method: "POST", body: JSON.stringify(parsed) }));
}

export function coordinatedCalendarChanges(env: AppBindings, local?: { id: string; handler: CalendarExternalChangeHandler }): CalendarExternalChangeHandler {
  return {
    async reconcileCalendarChange(change: CalendarExternalChange) {
      const booking = change.bookingId ? await new BookingsRepository(env.DB).getById(change.bookingId) : await new BookingsRepository(env.DB).getByProviderEventId(change.providerEventId);
      const erased = !booking && change.bookingId ? await env.DB.prepare("SELECT booking_id AS id FROM erased_calendar_targets WHERE booking_id = ?").bind(change.bookingId).first<{ id: string }>() : null;
      const target = booking?.id ?? erased?.id;
      if (!target) return;
      if (local && env.BOOKING_COORDINATOR.idFromName(target).toString() === local.id) return local.handler.reconcileCalendarChange(change);
      await forwardBookingRequest(env, target, new Request("http://coordinator.internal/__calendar-change", { method: "POST", body: JSON.stringify(change) }));
    },
  };
}

/** Scheduled recovery uses the same per-booking boundary as callbacks and mutations. */
export async function processDueCalendarDeletionProbes(env: AppBindings) {
  const probes = await new CalendarDeletionProbesRepository(env.DB).due(new Date().toISOString());
  for (const probe of probes) await forwardBookingRequest(env, probe.bookingId, new Request("http://coordinator.internal/__calendar-probe", {
    method: "POST", body: JSON.stringify({ bookingId: probe.bookingId, providerEventId: probe.providerEventId }),
  }));
  return probes.length;
}

export async function forwardBookingRequest(env: AppBindings, bookingId: string, request: Request) {
  if (!env.BOOKING_COORDINATOR) throw new Error("Missing Worker binding: BOOKING_COORDINATOR");
  // Materialize the incoming body before crossing invocations. Some protected
  // commands reject or succeed without parsing JSON, and must not leave a lazy
  // request stream owned by the caller after that caller sends its response.
  const forwarded = request.body ? new Request(request, { body: await request.arrayBuffer() }) : request;
  const response = await env.BOOKING_COORDINATOR.get(env.BOOKING_COORDINATOR.idFromName(bookingId)).fetch(forwarded);
  if (new URL(request.url).hostname === "coordinator.internal") {
    // Internal callers do not forward the response. Drain its body before their
    // invocation ends so a DO subrequest cannot outlive the owning Worker request.
    const body = await response.arrayBuffer();
    if (!response.ok) throw new Error("Booking coordination failed");
    return new Response(body.byteLength ? body : null, { status: response.status, headers: response.headers });
  }
  return response;
}

export async function processDueRescheduleRequests(env: AppBindings) {
  const requests = await new BookingsRepository(env.DB).requests.due(new Date().toISOString());
  for (const request of requests) await forwardBookingRequest(env,request.bookingId,new Request("http://coordinator.internal/__reschedule-request",{method:"POST",body:JSON.stringify(request)}));
}

export async function processDueApprovalRequests(env:AppBindings){
  const requests=await new BookingsRepository(env.DB).approvals.due();
  for(const request of requests)await forwardBookingRequest(env,request.bookingId,new Request("http://coordinator.internal/__approval-expiry",{method:"POST",body:JSON.stringify({id:request.id})}));
}
