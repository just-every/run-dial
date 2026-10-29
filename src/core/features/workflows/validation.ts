import type { Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { hostAllowed, refusal } from "../public-api/support";

type Configuration={action:string;trigger:string;eventTypeId:string;webhookSubscriptionId?:string|null;routingFormId?:string|null};
export async function workflowDestinationError(c:Context<AppEnvironment>,input:Configuration) {
 const credential=c.get("apiCredential");
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
  if(!destination||!destination.events.includes("workflow.action.v1")||!host||credential.teamId&&(destination.scope!=="team"||destination.scopeId!==credential.teamId)
   ||credential.hostId&&destination.scope==="workspace"
   ||destination.scope==="host"&&destination.scopeId!==host.id
   ||destination.scope==="team"&&!await c.get("apiDatabase").prepare("SELECT 1 FROM team_event_types WHERE team_id=? AND event_type_id=?").bind(destination.scopeId,input.eventTypeId).first()
   ||input.trigger==="routing-without-booking"&&destination.scope==="team")return refusal(c,404,"not_found","This webhook destination is outside the workflow grant.");
 }else if(input.webhookSubscriptionId)return refusal(c,400,"invalid_workflow_destination","A webhook destination requires a webhook action.");
}
