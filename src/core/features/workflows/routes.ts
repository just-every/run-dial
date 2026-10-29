import { Hono } from "hono";
import { createId, nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { eventAllowed, idempotent, page, refusal, type ApiEnvironment } from "../public-api";
import { workflowInput,workflowPatch,workflowView,type WorkflowRule } from "./types";

const missing={error:{code:"not_found",message:"This workflow does not exist."}};
export const workflowRoutes=new Hono<ApiEnvironment>()
 .get("/api/v1/workflows",async c=>{
  const rows=(await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE removed_at IS NULL ORDER BY id").all<WorkflowRule>()).results;
  const scoped=[];for(const row of rows)if(await eventAllowed(c,c.get("apiCredential"),row.event_type_id))scoped.push(workflowView(row));
  return page(c,scoped);
 })
 .get("/api/v1/workflows/:id",async c=>{
  const row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=? AND removed_at IS NULL").bind(c.req.param("id")).first<WorkflowRule>();
  return row&&await eventAllowed(c,c.get("apiCredential"),row.event_type_id)?c.json(workflowView(row)):refusal(c,404,"not_found","This workflow does not exist.");
 })
 .post("/api/v1/workflows",validate("json",workflowInput),async c=>{
  const input=c.req.valid("json"),credential=c.get("apiCredential");
  if(!await c.get("services").eventTypes.getEventType(input.eventTypeId)||!await eventAllowed(c,credential,input.eventTypeId))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,input,async()=>{
   const id=createId(),now=nowIso();
   await c.get("apiDatabase").prepare(`INSERT INTO workflow_rules(id,name,event_type_id,operator_id,enabled,enabled_at,subject,text,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,input.name,input.eventTypeId,credential.operatorId,input.enabled?1:0,input.enabled?now:null,input.subject,input.text,now,now).run();
   const row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
   if(!row)throw new Error("workflow_creation_missing");
   return {status:201,body:workflowView(row)};
  });
 })
 .patch("/api/v1/workflows/:id",validate("json",workflowPatch),async c=>{
  const id=c.req.param("id"),input=c.req.valid("json"),row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
  if(!row||!await eventAllowed(c,c.get("apiCredential"),row.event_type_id))return refusal(c,404,"not_found","This workflow does not exist.");
  return idempotent(c,input,async()=>{
   const now=nowIso(),enabled=input.enabled??row.enabled===1;
   const result=await c.get("apiDatabase").prepare(`UPDATE workflow_rules SET name=?,subject=?,text=?,enabled=?,
    enabled_at=CASE WHEN ?=0 THEN NULL WHEN enabled=0 THEN ? ELSE enabled_at END,version=version+1,updated_at=?
    WHERE id=? AND removed_at IS NULL`).bind(input.name??row.name,input.subject??row.subject,input.text??row.text,enabled?1:0,enabled?1:0,now,now,id).run();
   if(!result.meta.changes)return {status:404,body:missing};
   const updated=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
   if(!updated)throw new Error("workflow_update_missing");
   return {status:200,body:workflowView(updated)};
  });
 })
 .delete("/api/v1/workflows/:id",async c=>{
  const id=c.req.param("id"),row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
  if(!row||!await eventAllowed(c,c.get("apiCredential"),row.event_type_id))return refusal(c,404,"not_found","This workflow does not exist.");
  return idempotent(c,{},async()=>{
   const now=nowIso();
   await c.get("apiDatabase").prepare("UPDATE workflow_rules SET enabled=0,enabled_at=NULL,removed_at=COALESCE(removed_at,?),version=version+1,updated_at=? WHERE id=?").bind(now,now,id).run();
   return {status:200,body:{id,removed:true}};
  });
 });
