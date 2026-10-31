import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";

const pagination = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) });

/** Native operator session only. No public email lookup or remembered-details
 * authority is provided by this read-only scheduling-history door.
 */
export const clientRoutes = new Hono<AppEnvironment>()
  .get("/api/app/clients", validate("query", pagination), async context => {
    context.header("Cache-Control", "private, no-store");
    const { limit, offset } = context.req.valid("query");
    return context.json(await context.get("services").clients.list(limit, offset));
  })
  .get("/api/app/clients/history", validate("query", pagination.extend({ email: z.string().trim().email().max(320) })), async context => {
    context.header("Cache-Control", "private, no-store");
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
    return context.json({ ...await services.clients.records.details(email), name: history.name, totalCount: history.totalCount, bookings });
  })
  .post("/api/app/clients/notes", validate("json", z.object({ email: z.string().trim().email().max(320), body: z.string().trim().min(1).max(5000) }).strict()), async context => {
    context.header("Cache-Control", "private, no-store");
    const services = context.get("services"); await services.operators.requireMutation(context.req.raw);
    const { email, body } = context.req.valid("json");
    const id = await services.clients.records.add(email, { body, operatorId: context.get("session").id });
    return id ? context.json({ id },201) : apiError(context,404,"client_not_found","The client does not exist.");
  })
  .post("/api/app/clients/notes/:id/edit", validate("json", z.object({ email: z.string().trim().email().max(320), body: z.string().trim().min(1).max(5000) }).strict()), async context => {
    context.header("Cache-Control", "private, no-store");
    const services = context.get("services"); await services.operators.requireMutation(context.req.raw);
    const { email, body } = context.req.valid("json");
    return await services.clients.records.changeNote(email, context.req.param("id"), body) ? context.json({ id: context.req.param("id") }) : apiError(context,404,"note_not_found","The note does not exist.");
  })
  .post("/api/app/clients/notes/:id/remove", validate("json", z.object({ email: z.string().trim().email().max(320) }).strict()), async context => {
    context.header("Cache-Control", "private, no-store");
    const services = context.get("services"); await services.operators.requireMutation(context.req.raw);
    return await services.clients.records.changeNote(context.req.valid("json").email, context.req.param("id")) ? context.json({ id: context.req.param("id") }) : apiError(context,404,"note_not_found","The note does not exist.");
  })
  .post("/api/app/clients/fields", validate("json", z.object({ email: z.string().trim().email().max(320), label: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(5000) }).strict()), async context => {
    context.header("Cache-Control", "private, no-store");
    const services = context.get("services"); await services.operators.requireMutation(context.req.raw);
    const { email, label, value } = context.req.valid("json");
    const id = await services.clients.records.add(email, { label, value });
    return id ? context.json({ id },201) : apiError(context,409,"client_field_refused","The client is unavailable or its custom fields are full.");
  })
  .post("/api/app/clients/merge", validate("json", z.object({ source: z.string().trim().email().max(320), target: z.string().trim().email().max(320) }).strict()), async context => {
    context.header("Cache-Control", "private, no-store");
    const services = context.get("services"); await services.operators.requireMutation(context.req.raw);
    const input = context.req.valid("json"), result = await services.clients.records.merge(input.source,input.target,context.get("session").id);
    if (result === "missing") return apiError(context,404,"client_not_found","Both clients must exist.");
    if (result === "identical") return apiError(context,409,"client_identical","Choose two different client records.");
    return context.json(await services.clients.records.details(input.target));
  });
