import type { Context } from "hono";
import type { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { createId } from "../../shared/ids";
import { hashToken } from "../../platform/auth/tokens";
import type { RoutingForm, SubmissionResult, submissionSchema } from "./types";

/** Evaluate the same ordered rules before either door issues or consumes authority. */
export function routingAnswerDecision(config:RoutingForm,answers:Record<string,string>){
 const invalid=config.questions.filter(question=>question.required&&(!Object.hasOwn(answers,question.key)||!answers[question.key]?.trim())).map(question=>question.key);
 const keys=new Set(config.questions.map(question=>question.key));
 invalid.push(...Object.keys(answers).filter(key=>!keys.has(key)));
 const rule=config.rules.find(candidate=>Object.hasOwn(answers,candidate.questionKey)&&answers[candidate.questionKey]===candidate.equals);
 return {invalid,rule};
}

/** The invitee and machine doors share the capability check and atomic submission. */
export async function submitRoutingForm(context:Context<AppEnvironment>,formId:string,input:z.infer<typeof submissionSchema>){
 context.header("Cache-Control","no-store");
 const repository=context.get("services").routing,form=await repository.get(formId);
 if(!form)return apiError(context,404,"routing_form_not_found","This routing form is not available.");
 const secret=context.get("runtime").SESSION_SECRET,hash=await hashToken(input.nonce,secret);
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
 const {invalid,rule}=routingAnswerDecision(config,input.answers);
 if(invalid.length)return apiError(context,400,"invalid_answers","Complete the named routing questions.",invalid);
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
}
