import { apiHosts } from "../api-credentials";
import { Hono } from "hono";
import { eventTypeCreationSchema, eventTypeInputSchema } from "../event-types";
import { toPublicEventType } from "../event-types";
import { formSchema, type RoutingForm } from "../routing";
import { routingAnswerDecision, submitRoutingForm } from "../routing";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { apiError } from "../../shared/http";
import { pollInput } from "../polls";
import { validate } from "../../shared/validation";
import { createId } from "../../shared/ids";
import { apiTeamSchema as teamInput, apiRoutingSubmissionSchema as routingSubmission, apiWebhookSchema as webhookInput } from "./request-schemas";
import { eventAllowed, hostAllowed, hasRequestReceipt, idempotent, page, parsePage, pageResult, refusal, type ApiEnvironment } from "./support";

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
  const body=c.req.valid("json");return idempotent(c,body,async()=>{const event=await c.get("services").eventTypes.createEventType(body);
    const credential=c.get("apiCredential");
    if(credential.hostId&&await c.get("apiDatabase").prepare("SELECT id FROM api_hosts WHERE id=?").bind(credential.hostId).first())await c.get("apiDatabase").prepare("INSERT INTO api_event_hosts(event_type_id,host_id) VALUES(?,?)").bind(event.id,credential.hostId).run();
    return {status:201,body:{id:event.id,status:event.status,...toPublicEventType(event)}};});
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
 .post("/api/v1/event-types/:id/disable",async c=>{
  const id=c.req.param("id"),credential=c.get("apiCredential");
  if(!await eventAllowed(c,credential,id))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,{},async()=>{
    const event=await c.get("services").eventTypes.disableEventType(id);
    return event?{status:200,body:{id:event.id,status:event.status,...toPublicEventType(event)}}:{status:404,body:fail("not_found")};
  });
 })
 .delete("/api/v1/event-types/:id",async c=>{
  const id=c.req.param("id");
  if(!await eventAllowed(c,c.get("apiCredential"),id)&&!await hasRequestReceipt(c))return refusal(c,404,"not_found","This event type does not exist.");
  return idempotent(c,{},async()=>{
    const deleted=await c.get("services").eventTypes.deleteEventType(id);
    return deleted?{status:200,body:{id,deleted:true}}:{status:404,body:fail("not_found")};
  });
 })
 .get("/api/v1/hosts",async c=>{
  const host=await hostAllowed(c,c.get("apiCredential"));
  const credential=c.get("apiCredential");
  const teamHosts=credential.teamId?(await c.get("apiDatabase").prepare("SELECT DISTINCT COALESCE(a.host_id,(SELECT id FROM host_profiles WHERE singleton_key='default')) AS id FROM team_event_types t LEFT JOIN api_event_hosts a ON a.event_type_id=t.event_type_id WHERE t.team_id=?").bind(credential.teamId).all<{id:string}>()).results.map(row=>row.id):null;
  return page(c,host?(await apiHosts(c.get("apiDatabase"))).filter(row=>(!credential.hostId||row.id===credential.hostId)&&(!teamHosts||teamHosts.includes(row.id))).map(({id,name})=>({id,name})):[]);
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
  const bounds=parsePage(c);if(bounds instanceof Response)return bounds;
  const rows=(await c.get("apiDatabase").prepare("SELECT id,form_id AS formId,event_type_id AS eventTypeId,team_id AS teamId,rule_id AS ruleId,state,result_json AS resultJson,created_at AS createdAt FROM routing_submissions WHERE host_id=? AND (? IS NULL OR team_id=?) AND id>? ORDER BY id LIMIT ?")
    .bind(host?.id??"",credential.teamId,credential.teamId,bounds.after,bounds.limit+1).all<{id:string;formId:string;eventTypeId:string|null;teamId:string|null;ruleId:string|null;state:string;resultJson:string;createdAt:string}>()).results;
  return pageResult(c,rows.map(({resultJson,...row})=>({...row,result:JSON.parse(resultJson)})),bounds.limit);
 })
 .get("/api/v1/polls",async c=>{
  const credential=c.get("apiCredential"),bounds=parsePage(c);if(bounds instanceof Response)return bounds;
  const rows=(await c.get("apiDatabase").prepare(`SELECT id,event_type_id AS eventTypeId,title,closes_at AS closesAt,state,show_tally AS showTally,hold_link_id AS holdLinkId FROM meeting_polls p
    WHERE id>? AND (? IS NULL OR COALESCE((SELECT host_id FROM api_event_hosts a WHERE a.event_type_id=p.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM team_event_types t WHERE t.team_id=? AND t.event_type_id=p.event_type_id)) ORDER BY id LIMIT ?`)
    .bind(bounds.after,credential.hostId,credential.hostId,credential.teamId,credential.teamId,bounds.limit+1).all<{id:string;eventTypeId:string;title:string;closesAt:string;state:string;showTally:number;holdLinkId:string|null}>()).results;
  return pageResult(c,rows,bounds.limit);
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
  const credential=c.get("apiCredential"),id=c.req.param("id");
  return idempotent(c,{},async()=>{
    const status=await c.get("services").webhooks.subscriptions.status();
    const exists=status.subscriptions.some(s=>s.id===id&&(credential.teamId?s.scope==="team"&&s.scopeId===credential.teamId:credential.hostId?s.scope==="host"&&s.scopeId===credential.hostId:true));
    return exists?{status:200,body:{deleted:await c.get("services").webhooks.subscriptions.remove(id)}}:{status:404,body:fail("not_found")};
  });
 });
