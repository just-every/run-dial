import type { Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { hostAllowed, refusal } from "../public-api";

type Configuration={enabled?:boolean;crmConnectionId?:string|null;action:string;trigger:string;eventTypeId:string;webhookSubscriptionId?:string|null;routingFormId?:string|null};
export async function workflowDestinationError(c:Context<AppEnvironment>,input:Configuration) {
 const credential=c.get("apiCredential");
 if(input.action==="hubspot-contact-update"){
  if(input.trigger==="routing-without-booking")return refusal(c,400,"invalid_workflow_source","A CRM update requires a booking with a known contact.");
  const connection=input.crmConnectionId?await c.get("apiDatabase").prepare("SELECT id,status FROM workflow_crm_connections WHERE id=?").bind(input.crmConnectionId).first<{id:string;status:string}>():undefined;
  if(!connection||input.enabled!==false&&connection.status!=="connected")return refusal(c,404,"not_found","Choose an owner-authorized, connected CRM account.");
 }else if(input.crmConnectionId)return refusal(c,400,"invalid_workflow_destination","A CRM destination requires the CRM action.");
 if(input.trigger==="routing-without-booking"){
  if(!credential.scopes.includes("routing:manage"))return refusal(c,403,"scope_forbidden","Routing workflows require the routing grant.");
  const form=input.routingFormId?await c.get("services").routing.get(input.routingFormId):undefined;
  const host=await hostAllowed(c,credential);
  if(input.action!=="webhook")return refusal(c,400,"invalid_workflow_action","Routing-only actions require a webhook destination.");
  if(!form||form.hostId!==host?.id||credential.teamId)return refusal(c,404,"not_found","This routing form is outside the workflow grant.");
 }else if(input.routingFormId)return refusal(c,400,"invalid_workflow_source","A routing form requires the routing-only trigger.");
 if(input.action==="webhook"){
  if(!credential.scopes.includes("webhooks:manage"))return refusal(c,403,"scope_forbidden","Webhook workflows require the webhook grant.");
  const subscriptions=await c.get("services").webhooks.subscriptions.status();
  const destination=subscriptions.subscriptions.find(row=>row.id===input.webhookSubscriptionId);
  const host=await hostAllowed(c,credential);
  const eventHost=await c.get("apiDatabase").prepare("SELECT COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=?),(SELECT id FROM host_profiles WHERE singleton_key='default')) AS id").bind(input.eventTypeId).first<{id:string}>();
  const routingHost=input.routingFormId?(await c.get("services").routing.get(input.routingFormId))?.hostId:undefined;
  if(!destination||!destination.events.includes("workflow.action.v1")||!host||credential.teamId&&(destination.scope!=="team"||destination.scopeId!==credential.teamId)
   ||credential.hostId&&destination.scope==="workspace"
   ||destination.scope==="host"&&destination.scopeId!==(routingHost??eventHost?.id)
   ||destination.scope==="team"&&!await c.get("apiDatabase").prepare("SELECT 1 FROM team_event_types WHERE team_id=? AND event_type_id=?").bind(destination.scopeId,input.eventTypeId).first()
   ||input.trigger==="routing-without-booking"&&destination.scope==="team")return refusal(c,404,"not_found","This webhook destination is outside the workflow grant.");
 }else if(input.webhookSubscriptionId)return refusal(c,400,"invalid_workflow_destination","A webhook destination requires a webhook action.");
}
