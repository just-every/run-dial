import { Hono } from "hono";
import { createId, nowIso } from "../../shared/ids";
import { discardRequestBody } from "../../shared/http";
import { validate } from "../../shared/validation";
import { bookingAllowed, eventAllowed, idempotent, page, parsePage, pageResult, refusal, type ApiEnvironment } from "../public-api";
import { requireScope } from "../api-credentials";
import { BookingCorrespondenceRepository } from "../delivery";
import { workflowMessage, workflowTemplateErrors } from "./templates";
import { workflowInput,workflowPatch,workflowView,workflowAction,workflowTrigger,type WorkflowRule } from "./types";
import { workflowDestinationError } from "./validation";
import { workflowRuns } from "./runs";

const missing={error:{code:"not_found",message:"This workflow does not exist."}};
export const workflowRoutes=new Hono<ApiEnvironment>()
 .use("/api/v1/workflows*",async(c,next)=>{
  const owner=await c.get("apiDatabase").prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(c.get("apiCredential").operatorId).first();
  if(!owner){await discardRequestBody(c.req.raw);return refusal(c,403,"role_forbidden","Only a workspace owner can authorize workflows.");}
  await next();
 })
 .get("/api/v1/workflows",async c=>{
  const rows=(await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE removed_at IS NULL ORDER BY id").all<WorkflowRule>()).results;
  const scoped=[];for(const row of rows)if(await eventAllowed(c,c.get("apiCredential"),row.event_type_id))scoped.push(workflowView(row));
  return page(c,scoped);
 })
 .get("/api/v1/workflows/:id",async c=>{
  const row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=? AND removed_at IS NULL").bind(c.req.param("id")).first<WorkflowRule>();
  return row&&await eventAllowed(c,c.get("apiCredential"),row.event_type_id)?c.json(workflowView(row)):refusal(c,404,"not_found","This workflow does not exist.");
 })
 .get("/api/v1/workflows/:id/preview",async c=>{
  const credential=c.get("apiCredential"),denied=await requireScope(c,credential,"bookings:read");if(denied)return denied;
  const row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=? AND removed_at IS NULL").bind(c.req.param("id")).first<WorkflowRule>();
  const booking=await bookingAllowed(c,credential,c.req.query("bookingId")??"");
  if(!row||!booking||booking.eventTypeId!==row.event_type_id)return refusal(c,404,"not_found","This workflow or booking does not exist.");
  const data=await new BookingCorrespondenceRepository(c.get("apiDatabase")).read(booking.id,booking.occurrence.id,c.get("runtime"));
  if(!data)return refusal(c,409,"booking_unavailable","This booking cannot be previewed.");
  try{return c.json(workflowMessage({subject:row.subject,text:row.text,action:row.action},data,"[Invitee management link]"));}
  catch{return refusal(c,409,"invalid_template","Update the workflow's unavailable variables.");}
 })
 .get("/api/v1/workflows/:id/runs",async c=>{
  const id=c.req.param("id"),db=c.get("apiDatabase"),rule=await db.prepare("SELECT * FROM workflow_rules WHERE id=? AND removed_at IS NULL").bind(id).first<WorkflowRule>();
  if(!rule||!await eventAllowed(c,c.get("apiCredential"),rule.event_type_id))return refusal(c,404,"not_found","This workflow does not exist.");
  const bounds=parsePage(c);if(bounds instanceof Response)return bounds;
  return pageResult(c,await workflowRuns(db,id,bounds.limit+1,bounds.after),bounds.limit);
 })
 .post("/api/v1/workflows",validate("json",workflowInput),async c=>{
  const input=c.req.valid("json"),credential=c.get("apiCredential");
  if(!await c.get("services").eventTypes.getEventType(input.eventTypeId)||!await eventAllowed(c,credential,input.eventTypeId))return refusal(c,404,"not_found","This event type does not exist.");
  const destinationError=await workflowDestinationError(c,input);if(destinationError)return destinationError;
  const event=await c.get("services").eventTypes.getEventType(input.eventTypeId);
  const invalid=workflowTemplateErrors(input,event?.questions??[]);
  if(invalid.length)return refusal(c,400,"invalid_template",`Unavailable workflow variable: ${invalid.join(", ")}`);
  return idempotent(c,input,async()=>{
   const id=createId(),now=nowIso();
   await c.get("apiDatabase").prepare(`INSERT INTO workflow_rules(id,name,event_type_id,operator_id,enabled,enabled_at,subject,text,trigger,action,offset_minutes,created_at,updated_at,action_kind,trigger_kind,routing_form_id,webhook_subscription_id,action_type,crm_connection_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,input.name,input.eventTypeId,credential.operatorId,input.enabled?1:0,input.enabled?now:null,input.subject,input.text,input.trigger==="routing-without-booking"?"booking-created":input.trigger,input.action==="email-hosts"?"email-hosts":"email-invitee",input.offsetMinutes,now,now,input.action==="webhook"?input.action:null,input.trigger==="routing-without-booking"?input.trigger:null,input.routingFormId??null,input.webhookSubscriptionId??null,input.action,input.crmConnectionId??null).run();
   const row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
   if(!row)throw new Error("workflow_creation_missing");
   return {status:201,body:workflowView(row)};
  });
 })
 .patch("/api/v1/workflows/:id",validate("json",workflowPatch),async c=>{
  const id=c.req.param("id"),input=c.req.valid("json"),row=await c.get("apiDatabase").prepare("SELECT * FROM workflow_rules WHERE id=?").bind(id).first<WorkflowRule>();
  if(!row||!await eventAllowed(c,c.get("apiCredential"),row.event_type_id))return refusal(c,404,"not_found","This workflow does not exist.");
  const config={...workflowView(row),...input};
  const destinationError=await workflowDestinationError(c,config);if(destinationError)return destinationError;
  const event=await c.get("services").eventTypes.getEventType(row.event_type_id);
  const invalid=workflowTemplateErrors({subject:input.subject??row.subject,text:input.text??row.text,action:input.action??workflowAction(row)},event?.questions??[]);
  if(invalid.length)return refusal(c,400,"invalid_template",`Unavailable workflow variable: ${invalid.join(", ")}`);
  return idempotent(c,input,async()=>{
   const now=nowIso(),enabled=input.enabled??row.enabled===1;
   const trigger=input.trigger??workflowTrigger(row),action=input.action??workflowAction(row);
   const result=await c.get("apiDatabase").prepare(`UPDATE workflow_rules SET name=?,subject=?,text=?,trigger=?,action=?,offset_minutes=?,enabled=?,
    enabled_at=CASE WHEN ?=0 THEN NULL WHEN enabled=0 THEN ? ELSE enabled_at END,version=version+1,updated_at=?
    ,action_kind=?,trigger_kind=?,routing_form_id=?,webhook_subscription_id=?,action_type=?,crm_connection_id=?,authority_revoked_at=CASE WHEN ?=1 THEN NULL ELSE authority_revoked_at END WHERE id=? AND removed_at IS NULL`)
    .bind(input.name??row.name,input.subject??row.subject,input.text??row.text,trigger==="routing-without-booking"?"booking-created":trigger,action==="email-hosts"?"email-hosts":"email-invitee",input.offsetMinutes??row.offset_minutes,enabled?1:0,enabled?1:0,now,now,action==="webhook"?action:null,trigger==="routing-without-booking"?trigger:null,config.routingFormId,config.webhookSubscriptionId,action,config.crmConnectionId,input.enabled===true?1:0,id).run();
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
