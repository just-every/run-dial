import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { createId, nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { apiHosts, auditCredential, requireCredentialAdmin } from "./authority";

export const credentialHostRoutes=new Hono<AppEnvironment>()
 .use("/api/app/api-hosts*",async(c,next)=>{const refusal=await requireCredentialAdmin(c);if(refusal)return refusal;await next();})
 .get("/api/app/api-hosts",async c=>c.json({hosts:await apiHosts(c.get("apiDatabase"))}))
 .post("/api/app/api-hosts",validate("json",z.object({operatorId:z.string().min(1).max(128)}).strict()),async c=>{
  const db=c.get("apiDatabase"),{operatorId}=c.req.valid("json");
  const person=await db.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active'").bind(operatorId).first();
  if(!person)return apiError(c,404,"operator_not_found","Choose an active workspace person.");
  const existing=(await apiHosts(db)).find(host=>host.operatorId===operatorId);
  if(existing)return c.json(existing);
  const id=createId(),now=nowIso();
  await db.prepare("INSERT INTO api_hosts(id,operator_id,created_at,updated_at) VALUES(?,?,?,?)").bind(id,operatorId,now,now).run();
  await auditCredential(db,c.get("session").id,"host_registered",id);
  return c.json((await apiHosts(db)).find(host=>host.id===id),201);
 })
 .post("/api/app/api-hosts/:id/events",validate("json",z.object({eventTypeId:z.string().length(26),transferBookings:z.literal(true)}).strict()),async c=>{
  const db=c.get("apiDatabase"),host=(await apiHosts(db)).find(host=>host.id===c.req.param("id"));
  if(!host)return apiError(c,404,"host_not_found","Choose an active host.");
  const {eventTypeId}=c.req.valid("json");
  if(!await db.prepare("SELECT id FROM event_types WHERE id=?").bind(eventTypeId).first())return apiError(c,404,"event_not_found","Choose an existing event type.");
  if(await db.prepare("SELECT id FROM api_hosts WHERE id=?").bind(host.id).first()){
    await db.prepare("INSERT INTO api_event_hosts(event_type_id,host_id) VALUES(?,?) ON CONFLICT(event_type_id) DO UPDATE SET host_id=excluded.host_id").bind(eventTypeId,host.id).run();
  }else await db.prepare("DELETE FROM api_event_hosts WHERE event_type_id=?").bind(eventTypeId).run();
  await auditCredential(db,c.get("session").id,"event_host_transferred",eventTypeId);
  return c.json({eventTypeId,hostId:host.id});
 });
