import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { createId, nowIso } from "../../shared/ids";

const inputSchema = z.object({ name: z.string().trim().min(1).max(120), eventTypeIds: z.array(z.string().regex(/^[0-9A-Z]{26}$/)).max(50) }).strict();

export const teamRoutes = new Hono<AppEnvironment>()
 .get("/api/app/teams", async context => {
  const db = context.env.DB;
  const teams = (await db.prepare("SELECT id,name,host_id AS hostId,created_at AS createdAt,updated_at AS updatedAt FROM teams ORDER BY created_at,id").all<{id:string;name:string;hostId:string;createdAt:string;updatedAt:string}>()).results;
  const members = (await db.prepare("SELECT team_id AS teamId,event_type_id AS eventTypeId FROM team_event_types ORDER BY event_type_id").all<{teamId:string;eventTypeId:string}>()).results;
  return context.json({teams:teams.map(team=>({...team,eventTypeIds:members.filter(member=>member.teamId===team.id).map(member=>member.eventTypeId)}))});
 })
 .post("/api/app/teams", validate("json",inputSchema), async context => {
  const profile = await context.get("services").hostProfile.getProfile();
  if (!profile) return apiError(context,409,"profile_required","Configure your host profile first.");
  const input = context.req.valid("json"), db=context.env.DB, eventTypeIds=[...new Set(input.eventTypeIds)];
  for (const eventId of eventTypeIds) if (!await db.prepare("SELECT id FROM event_types WHERE id=?").bind(eventId).first()) return apiError(context,400,"event_not_found","Choose an existing event type.",[eventId]);
  const id=createId(),now=nowIso();
  await db.batch([
   db.prepare("INSERT INTO teams(id,name,host_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,input.name,profile.id,now,now),
   ...eventTypeIds.map(eventId=>db.prepare("INSERT INTO team_event_types(team_id,event_type_id,created_at,updated_at) VALUES(?,?,?,?)").bind(id,eventId,now,now)),
  ]);
  return context.json({id,name:input.name,hostId:profile.id,eventTypeIds,createdAt:now,updatedAt:now},201);
 });
