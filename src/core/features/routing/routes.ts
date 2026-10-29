import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { createId } from "../../shared/ids";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { formParams, formSchema, submissionSchema, type RoutingForm, type SubmissionResult } from "./types";

export const routingRoutes = new Hono<AppEnvironment>()
 .get("/api/app/routing-forms",async context=>{
  return context.json({forms:await context.get("services").routing.list()});
 })
 .post("/api/app/routing-forms",validate("json",formSchema),async context=>{
  const profile=await context.get("services").hostProfile.getProfile();
  if(!profile)return apiError(context,409,"profile_required","Configure your host profile first.");
  const input=context.req.valid("json"),repository=context.get("services").routing;
  for(const rule of input.rules)if(!await repository.target(rule.eventTypeId,rule.teamId))return apiError(context,400,"routing_target_unavailable","Choose a published event belonging to the selected team.",[rule.id]);
  return context.json(await repository.create(input,profile.id),201);
 })
 .get("/api/public/routing/:id",validate("param",formParams),async context=>{
  const repository=context.get("services").routing,form=await repository.get(context.req.valid("param").id);
  if(!form)return apiError(context,404,"routing_form_not_found","This routing form is not available.");
  const input=JSON.parse(form.configJson) as RoutingForm,nonce=createOpaqueToken(),expiresAt=new Date(Date.now()+15*60000).toISOString();
  await repository.issue(form.id,await hashToken(nonce,context.get("runtime").SESSION_SECRET),expiresAt);
  context.header("Cache-Control","no-store");
  return context.json({id:form.id,title:form.title,questions:input.questions,capability:{nonce,expiresAt}});
 })
 .post("/api/public/routing/:id/submit",validate("param",formParams),validate("json",submissionSchema),async context=>{
  context.header("Cache-Control","no-store");
  const repository=context.get("services").routing,form=await repository.get(context.req.valid("param").id);
  if(!form)return apiError(context,404,"routing_form_not_found","This routing form is not available.");
  const input=context.req.valid("json"),secret=context.get("runtime").SESSION_SECRET,hash=await hashToken(input.nonce,secret);
  const capability=await repository.capability(form.id,hash);
  if(!capability)return apiError(context,404,"routing_capability_invalid","This submission capability is not available.");
  if(capability.expiresAt<=new Date().toISOString())return apiError(context,410,"routing_capability_expired","Open the form again to submit your answers.");
  const payloadHash=await hashToken(JSON.stringify(Object.entries(input.answers).sort(([a],[b])=>a<b?-1:a>b?1:0)),secret);
  if(capability.submissionId){
   if(capability.payloadHash!==payloadHash)return apiError(context,409,"routing_payload_mismatch","This capability was already used with different answers.");
   const result=await repository.result(capability.submissionId);
   if(!result)throw new Error("routing_submission_missing");
   return context.json(result);
  }
  const config=JSON.parse(form.configJson) as RoutingForm;
  const invalid=config.questions.filter(question=>question.required&&(!Object.hasOwn(input.answers,question.key)||!input.answers[question.key]?.trim())).map(question=>question.key);
  const keys=new Set(config.questions.map(question=>question.key));
  invalid.push(...Object.keys(input.answers).filter(key=>!keys.has(key)));
  if(invalid.length)return apiError(context,400,"invalid_answers","Complete the named routing questions.",invalid);
  const rule=config.rules.find(candidate=>Object.hasOwn(input.answers,candidate.questionKey)&&input.answers[candidate.questionKey]===candidate.equals);
  const submissionId=createId();
  let result:SubmissionResult={submissionId,message:config.defaultMessage};
  if(rule){
   const target=await repository.target(rule.eventTypeId,rule.teamId);
   if(!target)return apiError(context,409,"routing_target_unavailable","The selected booking destination is no longer available.");
   result={submissionId,eventTypeId:rule.eventTypeId,bookingPath:`/book/${target.handle}/${target.slug}`};
  }
  const stored=await repository.submit(form,capability.id,payloadHash,rule,result);
  if(stored)return context.json(stored,201);
  const current=await repository.capability(form.id,hash);
  if(current?.submissionId&&current.payloadHash===payloadHash){
   const replay=await repository.result(current.submissionId);
   if(replay)return context.json(replay);
  }
  return apiError(context,409,"routing_submission_conflict","The submission changed or its destination is no longer available.");
 });
