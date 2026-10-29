import { Hono } from "hono";
import { eventTypeCreationSchema, eventTypeInputSchema } from "../event-types/event-input";
import { toPublicEventType } from "../event-types/public";
import { formSchema, type RoutingForm } from "../routing/types";
import { routingAnswerDecision, submitRoutingForm } from "../routing/submission";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { apiError } from "../../shared/http";
import { pollInput } from "../polls/types";
import { validate } from "../../shared/validation";
import { createId } from "../../shared/ids";
import { apiTeamSchema as teamInput, apiRoutingSubmissionSchema as routingSubmission, apiWebhookSchema as webhookInput } from "./request-schemas";
import { eventAllowed, hostAllowed, idempotent, page, refusal, type ApiEnvironment } from "./support";

const fail=(code:string)=>({error:{code,message:"This request cannot be completed.",request_id:createId()}});
export const resourceRoutes=new Hono<ApiEnvironment>()
 .get("/api/v1/event-types",async c=>{
  const credential=c.get("apiCredential"),rows=[];
  for(const event of await c.get("services").eventTypes.listEventTypes())if(await eventAllowed(c,credential,event.id))rows.push({id:event.id,status:event.status,...toPublicEventType(event)});
  return page(c,rows);
 })
 .get("/api/v1/event-types/:id",async c=>{
  const id=c.req.param("id"),event=await c.get("services").eventTypes.getEventType(id);
  return event&&await eventAllowed(c,c.get("apiCredential"),id)?c.json({id:event.id,status:event.status,...toPublicEventType(event)}):refusal(c,404,"not_found","This event type does not exist.");
 })
 .post("/api/v1/event-types",validate("json",eventTypeCreationSchema),async c=>{
  if(c.get("apiCredential").teamId)return refusal(c,403,"scope_forbidden","A team credential cannot create workspace event types.");
  const body=c.req.valid("json");return idempotent(c,body,async()=>{const event=await c.get("services").eventTypes.createEventType(body);return {status:201,body:{id:event.id,status:event.status,...toPublicEventType(event)}};});
 })
 .put("/api/v1/event-types/:id",validate("json",eventTypeInputSchema),async c=>{
  const id=c.req.param("id"),body=c.req.valid("json"),services=c.get("services");
  if(!await services.eventTypes.getEventType(id)||!await eventAllowed(c,c.get("apiCredential"),id))return refusal(c,404,"not_found","This event type does not exist.");
  const correspondence=await services.correspondence.read(id);
  if(correspondence&&!services.correspondence.validateQuestions(correspondence,body.questions).success)return refusal(c,409,"template_question_in_use","Update the correspondence templates before removing referenced questions.");
  return idempotent(c,body,async()=>{const event=await services.eventTypes.updateEventType(id,body);return event?{status:200,body:{id:event.id,status:event.status,...toPublicEventType(event)}}:{status:404,body:fail("not_found")};});
 })
 .post("/api/v1/event-types/:id/publish",async c=>{
  const id=c.req.param("id");if(!await eventAllowed(c,c.get("apiCredential"),id))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,{},async()=>{const result=await c.get("services").eventTypes.publishEventType(id);return result.kind==="published"?{status:200,body:{id:result.eventType.id,status:result.eventType.status,...toPublicEventType(result.eventType)}}:{status:409,body:fail(result.kind)};});
 })
 .get("/api/v1/hosts",async c=>{
  const host=await hostAllowed(c,c.get("apiCredential"));
  return page(c,host?[{id:host.id,name:host.name,handle:host.handle,timezone:host.timezone}]:[]);
 })
 .get("/api/v1/teams",async c=>{
  const credential=c.get("apiCredential"),host=await hostAllowed(c,credential);
  return page(c,(await c.get("services").teams.list()).filter(team=>team.hostId===host?.id&&(!credential.teamId||credential.teamId===team.id)));
 })
 .post("/api/v1/teams",validate("json",teamInput),async c=>{
  const credential=c.get("apiCredential"),host=await hostAllowed(c,credential),body=c.req.valid("json");
  if(!host||credential.hostId||credential.teamId)return refusal(c,403,"scope_forbidden","Only a workspace credential may create teams.");
  for(const id of body.eventTypeIds)if(!await c.get("services").teams.eventExists(id))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,body,async()=>({status:201,body:await c.get("services").teams.create(body,host.id)}));
 })
 .get("/api/v1/routing-forms",async c=>{
  const credential=c.get("apiCredential"),host=await hostAllowed(c,credential);
  const rows=(await c.get("services").routing.list()).filter(form=>form.hostId===host?.id&&(!credential.teamId||form.rules.every(rule=>rule.teamId===credential.teamId)));
  return page(c,rows);
 })
 .post("/api/v1/routing-forms",validate("json",formSchema),async c=>{
  const credential=c.get("apiCredential"),host=await hostAllowed(c,credential),body=c.req.valid("json"),routing=c.get("services").routing;
  if(!host)return refusal(c,404,"not_found","This host does not exist.");
  for(const rule of body.rules)if(!await eventAllowed(c,credential,rule.eventTypeId)||credential.teamId&&rule.teamId!==credential.teamId||!await routing.target(rule.eventTypeId,rule.teamId))return refusal(c,404,"not_found","This routing target does not exist.");
  return idempotent(c,body,async()=>({status:201,body:await routing.create(body,host.id)}));
 })
 .post("/api/v1/routing-submissions",validate("json",routingSubmission),async c=>{
  const input=c.req.valid("json"),credential=c.get("apiCredential"),repository=c.get("services").routing;
  const host=await hostAllowed(c,credential),form=await repository.get(input.formId);
  if(!host||!form||form.hostId!==host.id)return refusal(c,404,"not_found","This routing form does not exist.");
  const config=JSON.parse(form.configJson) as RoutingForm,{invalid,rule}=routingAnswerDecision(config,input.answers);
  if(invalid.length)return apiError(c,400,"invalid_answers","Complete the named routing questions.",invalid);
  if(rule&&(!await eventAllowed(c,credential,rule.eventTypeId)||credential.teamId&&rule.teamId!==credential.teamId))return refusal(c,404,"not_found","This routing target does not exist.");
  if(rule&&!await repository.target(rule.eventTypeId,rule.teamId))return refusal(c,409,"routing_target_unavailable","The selected booking destination is no longer available.");
  return idempotent(c,input,async()=>{
   const nonce=createOpaqueToken(),secret=c.get("runtime").SESSION_SECRET;
   await repository.issue(form.id,await hashToken(nonce,secret),new Date(Date.now()+15*60000).toISOString());
   const response=await submitRoutingForm(c,form.id,{nonce,answers:input.answers});
   return {status:response.status,body:await response.json()};
  });
 })
 .get("/api/v1/routing-submissions",async c=>{
  const credential=c.get("apiCredential"),host=await hostAllowed(c,credential);
  const rows=(await c.env.DB.prepare("SELECT id,form_id AS formId,event_type_id AS eventTypeId,team_id AS teamId,rule_id AS ruleId,state,result_json AS resultJson,created_at AS createdAt FROM routing_submissions WHERE host_id=? AND (? IS NULL OR team_id=?) ORDER BY id LIMIT 1000")
    .bind(host?.id??"",credential.teamId,credential.teamId).all<{id:string;formId:string;eventTypeId:string|null;teamId:string|null;ruleId:string|null;state:string;resultJson:string;createdAt:string}>()).results;
  return page(c,rows.map(({resultJson,...row})=>({...row,result:JSON.parse(resultJson)})));
 })
 .get("/api/v1/polls",async c=>{
  const rows=[],credential=c.get("apiCredential");for(const poll of await c.get("services").polls.repository.list())if(await eventAllowed(c,credential,poll.eventTypeId))rows.push(poll);
  return page(c,rows);
 })
 .post("/api/v1/polls",validate("json",pollInput),async c=>{
  const body=c.req.valid("json");if(!await eventAllowed(c,c.get("apiCredential"),body.eventTypeId))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,body,async()=>{const poll=await c.get("services").polls.create(body);return poll?{status:201,body:poll}:{status:422,body:fail("poll_unavailable")};});
 })
 .get("/api/v1/polls/:id",async c=>{
  const poll=await c.get("services").polls.repository.get(c.req.param("id"));
  if(!poll||!await eventAllowed(c,c.get("apiCredential"),poll.eventTypeId))return refusal(c,404,"not_found","This poll does not exist.");
  return c.json(await c.get("services").polls.host(poll.id));
 })
 .post("/api/v1/polls/:id/close",async c=>{
  const poll=await c.get("services").polls.repository.get(c.req.param("id"));
  if(!poll||!await eventAllowed(c,c.get("apiCredential"),poll.eventTypeId))return refusal(c,404,"not_found","This poll does not exist.");
  return idempotent(c,{},async()=>{await c.get("services").polls.repository.close(poll.id);return {status:200,body:{closed:true}};});
 })
 .get("/api/v1/webhook-subscriptions",async c=>{
  const credential=c.get("apiCredential"),status=await c.get("services").webhooks.subscriptions.status();
  return page(c,status.subscriptions.filter(s=>credential.teamId?s.scope==="team"&&s.scopeId===credential.teamId:credential.hostId?s.scope==="host"&&s.scopeId===credential.hostId:true));
 })
 .post("/api/v1/webhook-subscriptions",validate("json",webhookInput),async c=>{
  const credential=c.get("apiCredential"),body=c.req.valid("json");
  return idempotent(c,body,async()=>{
    try{const created=await c.get("services").webhooks.subscriptions.create({...body,scope:credential.teamId?"team":credential.hostId?"host":"workspace",scopeId:credential.teamId??credential.hostId??null});
      return created?{status:201,body:created,replayBody:{id:created.id,secretShown:false}}:{status:422,body:fail("invalid_webhook_scope")};
    }catch{return {status:422,body:fail("endpoint_not_public_https")};}
  });
 })
 .delete("/api/v1/webhook-subscriptions/:id",async c=>{
  const credential=c.get("apiCredential"),id=c.req.param("id"),status=await c.get("services").webhooks.subscriptions.status();
  const exists=status.subscriptions.some(s=>s.id===id&&(credential.teamId?s.scope==="team"&&s.scopeId===credential.teamId:credential.hostId?s.scope==="host"&&s.scopeId===credential.hostId:true));
  if(!exists)return refusal(c,404,"not_found","This subscription does not exist.");
  return idempotent(c,{},async()=>({status:200,body:{deleted:await c.get("services").webhooks.subscriptions.remove(id)}}));
 });
