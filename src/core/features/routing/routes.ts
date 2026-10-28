import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { normaliseEmbedOrigin } from "../embeds/service";
import { attributionSchema } from "../bookings/link-context";
import { routingFormInput } from "./validation.mjs";

const id=z.object({id:z.string().regex(/^[0-9A-Z]{26}$/)}),slug=z.object({slug:z.string().regex(/^[a-z0-9-]{1,80}$/)});
const answers=z.record(z.string().max(100),z.union([z.string().max(4000),z.array(z.string().max(500)).max(50)]));
export const routingRoutes=new Hono<AppEnvironment>()
 .use("/api/app/routing-forms*",async(c,next)=>{c.header("Cache-Control","private, no-store");await next();})
 .get("/api/app/routing-forms",async c=>c.json(await c.get("services").routing.repository.list()))
 .get("/api/app/routing-forms/:id",validate("param",id),async c=>{const value=await c.get("services").routing.detail(c.req.valid("param").id);return value?c.json(value):apiError(c,404,"routing_unavailable","This routing form is unavailable.");})
 .post("/api/app/routing-forms",validate("json",routingFormInput),async c=>{
  await c.get("services").operators.requireMutation(c.req.raw);const value=await c.get("services").routing.save(c.req.valid("json"));
  return value?c.json(value,201):apiError(c,400,"invalid_route","Choose an existing event for each booking route.");
 })
 .put("/api/app/routing-forms/:id",validate("param",id),validate("json",routingFormInput),async c=>{
  await c.get("services").operators.requireMutation(c.req.raw);const formId=c.req.valid("param").id;
  if(!await c.get("services").routing.repository.get(formId))return apiError(c,404,"routing_unavailable","This routing form is unavailable.");
  const value=await c.get("services").routing.save(c.req.valid("json"),formId);return value?c.json(value):apiError(c,400,"invalid_route","Choose an existing event for each booking route.");
 })
 .post("/api/app/routing-forms/:id/preview",validate("param",id),validate("json",z.object({answers}).strict()),async c=>{
  const result=await c.get("services").routing.preview(c.req.valid("param").id,c.req.valid("json").answers);
  return !result?apiError(c,404,"routing_unavailable","This routing form is unavailable."):result.ok?c.json(result):apiError(c,400,"invalid_answers",`Review: ${result.fields.join(", ")}.`,result.fields);
 })
 .get("/api/public/routing/:slug",validate("param",slug),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");const result=await c.get("services").routing.read(c.req.valid("param").slug);
  return result?c.json(result):apiError(c,404,"routing_unavailable","This routing form is unavailable.");
 })
 .post("/api/public/routing/:slug",validate("param",slug),validate("json",z.object({token:z.string().max(200).optional(),answers,attribution:attributionSchema.optional()}).strict()),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");const input=c.req.valid("json");
  const result=await c.get("services").routing.submit(c.req.valid("param").slug,input.token??"",input.answers,input.attribution);
  if(result.kind==="invalid")return apiError(c,400,"invalid_answers",`Review: ${result.fields.join(", ")}.`,result.fields);
  return result.kind==="unavailable"?apiError(c,404,"routing_unavailable","This routing form or submission link is unavailable."):c.json(result,201);
 })
 .get("/route/:slug",validate("param",slug),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");
  return c.get("services").spaSurface.serve(c.req.raw,await c.get("services").routing.repository.publicForm(c.req.valid("param").slug)?200:404,{blockFraming:true});
 })
 .get("/embed/route/:slug",validate("param",slug),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");
  const parents=c.req.queries("parent")??[],parent=parents.length===1?normaliseEmbedOrigin(parents[0]):undefined;
  const allowed=parent&&await c.get("services").embeds.isOriginAllowed(parent)&&await c.get("services").routing.repository.publicForm(c.req.valid("param").slug);
  return c.get("services").spaSurface.serve(c.req.raw,allowed?200:404,allowed?{frameAncestors:[parent!]}:{blockFraming:true});
 });
