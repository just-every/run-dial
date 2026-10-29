import { Hono } from "hono";
import { submitRoutingForm } from "./submission";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { formParams, formSchema, submissionSchema, type RoutingForm } from "./types";

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
  return submitRoutingForm(context,context.req.valid("param").id,context.req.valid("json"));
 });
