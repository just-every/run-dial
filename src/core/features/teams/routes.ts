import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";

const inputSchema = z.object({ name: z.string().trim().min(1).max(120), eventTypeIds: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).max(50) }).strict();

export const teamRoutes = new Hono<AppEnvironment>()
 .get("/api/app/teams", async context => {
  return context.json({teams:await context.get("services").teams.list()});
 })
 .post("/api/app/teams", validate("json",inputSchema), async context => {
  const profile = await context.get("services").hostProfile.getProfile();
  if (!profile) return apiError(context,409,"profile_required","Configure your host profile first.");
  const input = context.req.valid("json"), repository=context.get("services").teams;
  for (const eventId of new Set(input.eventTypeIds)) if (!await repository.eventExists(eventId)) return apiError(context,400,"event_not_found","Choose an existing event type.",[eventId]);
  return context.json(await repository.create(input,profile.id),201);
 });
