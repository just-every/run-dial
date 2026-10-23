import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";

const pagination = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) });

/** Native operator session only. No public email lookup or remembered-details
 * authority is provided by this read-only scheduling-history door.
 */
export const clientRoutes = new Hono<AppEnvironment>()
  .get("/api/app/clients", validate("query", pagination), async context => {
    const { limit, offset } = context.req.valid("query");
    return context.json(await context.get("services").clients.list(limit, offset));
  })
  .get("/api/app/clients/history", validate("query", pagination.extend({ email: z.string().trim().email().max(320) })), async context => {
    const { email, limit, offset } = context.req.valid("query");
    const services = context.get("services");
    const history = await services.clients.history(email, limit, offset);
    const bookings = [];
    for (const id of history.ids) {
      const booking = await services.bookings.getForOperator(id);
      if (!booking) continue; // A concurrent erasure must never resurrect a cached record.
      bookings.push({ id: booking.id, name: booking.inviteeName, email: booking.inviteeEmail,
        eventTitle: booking.eventTitle, eventTypeId: booking.eventTypeId, state: booking.state,
        startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt,
        hostTimezone: booking.hostTimezone, inviteeTimezone: booking.inviteeTimezone,
        answers: booking.answers, attendance: booking.attendance, payment: booking.payment ?? null,
        customFields: await services.customFields.entries("booking", id),
      });
    }
    return context.json({ email: history.email, totalCount: history.totalCount, bookings });
  });
