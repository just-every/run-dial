import { withApplication, ArchiveMaintenance, maintenanceResponse } from "../features/portability/admission";
import { coordinatedCalendarChanges } from "./booking-coordination";
import { DurableObject } from "cloudflare:workers";
import { createApp } from "./hono";
import { createServices } from "./services";
import type { AppBindings } from "./bindings";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { deliveryJobSchema } from "../features/delivery";
import { calendarChangeSchema } from "../features/calendar-connection";
import { z } from "zod";
import { operatorNotificationBoundary } from "../platform/operator-notification-boundary";
import { invokeOperatorMail } from "../features/delivery/operator-invocation";
import { ProviderFailure } from "../platform/calendar";
import { ConnectionWatchSchedule, connectionWatchBoundary, connectionWatchObservers, connectionWatchPaths } from "./connection-watch";

const deletionProbeSchema = z.object({ bookingId: z.string().length(26), providerEventId: z.string().min(1).max(1024) }).strict();
const notificationSchema = z.object({ outboxId: z.string().min(1).max(256), attempt: z.number().int().positive() }).strict();


/** One booking's lifecycle and provider commands share one serialized execution boundary. */
export class BookingCoordinator extends DurableObject<AppBindings> {
  protected services(env: AppBindings) { return createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { files: env.FILES, connectionWatch: connectionWatchObservers(env) }); }

  private coordinatedServices(env: AppBindings) {
    const services = this.services(env);
    // Collection recovery runs outside booking gates to avoid A→B→A waits.
    services.calendar.setInlineRecoveryAllowed(false);
    services.calendar.setExternalChangeHandler(coordinatedCalendarChanges(env, { id: this.ctx.id.toString(), handler: { async reconcileCalendarChange(change) {
      await services.bookings.reconcileCalendarChange(change);
      if (change.bookingId) await services.erasure.reconcileCalendarFact(change.bookingId, change.kind, change.updatedAt ?? change.providerEventId);
    } } }));
    return services;
  }

  async fetch(request: Request): Promise<Response> {
    try { return await withApplication(this.env.DB, () => this.admittedFetch(request)); }
    catch (error) { if (error instanceof ArchiveMaintenance) return maintenanceResponse(); throw error; }
  }

  private async admittedFetch(request: Request): Promise<Response> {
    const pending: Promise<unknown>[] = [];
    try { return await this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/__operator-notifications/") && request.method === "POST") {
        if (this.ctx.id.toString() !== this.env.BOOKING_COORDINATOR.idFromName(operatorNotificationBoundary).toString()) return new Response("Wrong coordinator", { status: 400 });
        const services = this.services(this.env);
        const parsed = notificationSchema.safeParse(await request.json());
        if (!parsed.success || path !== "/__operator-notifications/send") return new Response("Invalid notification", { status: 400 });
        try {
          return Response.json({ value: await invokeOperatorMail(this.env.DB, services.mail, parsed.data.outboxId, parsed.data.attempt) });
        } catch (error) {
          const failure = error instanceof ProviderFailure ? error : new ProviderFailure("internal_error", false);
          return Response.json({ error: { code: failure.code, retryable: failure.retryable, retryAfterSeconds: failure.retryAfterSeconds } });
        }
      }
      if (connectionWatchPaths.includes(path) && request.method === "POST") {
        if (this.ctx.id.toString() !== this.env.BOOKING_COORDINATOR.idFromName(connectionWatchBoundary).toString()) return new Response("Wrong coordinator", { status: 400 });
        await new ConnectionWatchSchedule(this.ctx.storage).answer(path);
        return new Response(null, { status: 204 });
      }
      if (path === "/__delivery" && request.method === "POST") {
        const parsed = deliveryJobSchema.safeParse(await request.json());
        if (!parsed.success) return new Response("Invalid delivery job", { status: 400 });
        return Response.json({ result: await this.coordinatedServices(this.env).delivery.processUnknown(parsed.data) });
      }
      if (path === "/__calendar-change" && request.method === "POST") {
        const parsed = calendarChangeSchema.safeParse(await request.json());
        if (!parsed.success) return new Response("Invalid calendar fact", { status: 400 });
        const services = this.coordinatedServices(this.env);
        await services.bookings.reconcileCalendarChange(parsed.data);
        if (parsed.data.bookingId) await services.erasure.reconcileCalendarFact(parsed.data.bookingId, parsed.data.kind, parsed.data.updatedAt ?? parsed.data.providerEventId);
        return new Response(null, { status: 204 });
      }
      if(path==="/__approval-expiry" && request.method==="POST"){const body=z.object({id:z.string().length(26)}).parse(await request.json());await this.coordinatedServices(this.env).bookings.expireApproval(body.id);return new Response(null,{status:204});}
      if (path === "/__reschedule-request" && request.method === "POST") {
        const body=z.object({bookingId:z.string().length(26)}).parse(await request.json());
        await this.coordinatedServices(this.env).bookings.processRescheduleRequest(body.bookingId);
        return new Response(null,{status:204});
      }
      if (path === "/__calendar-probe" && request.method === "POST") {
        const parsed = deletionProbeSchema.safeParse(await request.json());
        if (!parsed.success) return new Response("Invalid deletion probe", { status: 400 });
        await this.coordinatedServices(this.env).bookings.reconcileDeletionProbe(parsed.data.bookingId, parsed.data.providerEventId);
        return new Response(null, { status: 204 });
      }
      return createApp(undefined, (env) => this.coordinatedServices(env)).fetch(request, this.env, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException() {} } as ExecutionContext);
    }); } finally { await Promise.allSettled(pending); }
  }

  /**
   * NOTIFY-007's watch. A due confirmation re-checks the connection, alerts if the failure persisted and dispatches the
   * alert it queued; a due re-check runs the full health check, which ends the incident when it reads healthy; a due
   * probe makes the health check's two provider reads, and a failure it sees starts an incident.
   */
  async alarm() {
    try { await withApplication(this.env.DB, () => this.admittedAlarm()); }
    catch (error) {
      if (!(error instanceof ArchiveMaintenance)) throw error;
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }

  private async admittedAlarm() {
    const schedule = new ConnectionWatchSchedule(this.ctx.storage);
    const due = await schedule.due();
    const services = this.services(this.env);
    services.calendar.setWatchObservers(schedule.observers());
    if (due?.kind === "confirm") {
      await services.delivery.confirmConnections();
      await services.delivery.enqueueDue(this.env.JOBS);
    } else if (due?.kind === "recheck") await services.calendar.checkConnection();
    else if (due?.kind === "probe") await services.calendar.probeConnection();
    const health = await services.calendar.connectionHealth();
    await schedule.settle(due, { connected: health.state !== "disconnected", healthy: health.state === "healthy" });
  }
}
