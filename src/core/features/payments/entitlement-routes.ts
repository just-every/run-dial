import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { productInput } from "./entitlements";
const eventId=z.object({id:z.string().min(1).max(64)});
const publicProduct=z.object({handle:z.string().regex(/^[a-z0-9-]+$/).max(80),slug:z.string().regex(/^[a-z0-9-]+$/).max(80),product:z.string().length(26)});
/** Native operator configuration and public purchase commands; all stored amounts are USD. */
export const entitlementRoutes=new Hono<AppEnvironment>()
 .get('/api/app/payments/entitlements',async c=>c.json(await c.get('services').payments.entitlements.list()))
 .get('/api/app/event-types/:id/products',validate('param',eventId),async c=>c.json(await c.get('services').payments.entitlements.products(c.req.valid('param').id)))
 .post('/api/app/event-types/:id/products',validate('param',eventId),validate('json',productInput),async c=>{
  const event=await c.get('services').eventTypes.getEventType(c.req.valid('param').id);
  if(!event)return apiError(c,404,'event_type_not_found','Event type not found.');
  return c.json(await c.get('services').payments.entitlements.define(event.id,c.req.valid('json')),201);
 })
 .post('/api/public/book/:handle/:slug/products/:product/purchase',validate('param',publicProduct),validate('json',z.object({email:z.string().trim().email().max(320),idempotencyKey:z.string().uuid()}).strict()),async c=>{
  const {handle,slug,product}=c.req.valid('param'),services=c.get('services');
  const profile=await services.hostProfile.getPublicProfile(handle);
  const event=profile?await services.eventTypes.resolvePublishedEventForPublicRequest(slug):undefined;
  if(!event||event.status!=='published')return apiError(c,404,'event_not_available','This event type is not available.');
  const input=c.req.valid('json'),result=await services.payments.entitlements.purchase(event.id,product,input.email,input.idempotencyKey,`/book/${handle}/${slug}`);
  if(result.kind==='not_found')return apiError(c,404,'product_not_found','This appointment product is not available.');
  if(result.kind==='refused')return apiError(c,409,'purchase_unavailable','This purchase cannot be started.',[result.reason]);
  return c.json(result,201);
 });
