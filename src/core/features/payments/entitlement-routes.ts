import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { productInput, couponInput } from "./entitlements";
const eventId=z.object({id:z.string().min(1).max(64)});
const publicEvent=z.object({handle:z.string().regex(/^[a-z0-9-]+$/).max(80),slug:z.string().regex(/^[a-z0-9-]+$/).max(80)});
const publicProduct=publicEvent.extend({product:z.string().length(26)});
/** Native operator configuration and public purchase commands; all stored amounts are USD. */
export const entitlementRoutes=new Hono<AppEnvironment>()
 .get('/api/app/payments/entitlements',async c=>c.json(await c.get('services').payments.entitlements.list()))
 .get('/api/app/event-types/:id/products',validate('param',eventId),async c=>c.json(await c.get('services').payments.entitlements.products(c.req.valid('param').id)))
 .post('/api/app/event-types/:id/products',validate('param',eventId),validate('json',productInput),async c=>{
  const event=await c.get('services').eventTypes.getEventType(c.req.valid('param').id);
  if(!event)return apiError(c,404,'event_type_not_found','Event type not found.');
  return c.json(await c.get('services').payments.entitlements.define(event.id,c.req.valid('json')),201);
 })
 .post('/api/app/event-types/:id/coupons',validate('param',eventId),validate('json',couponInput),async c=>{
  const services=c.get('services'),event=await services.eventTypes.getEventType(c.req.valid('param').id);
  if(!event)return apiError(c,404,'event_type_not_found','Event type not found.');
  const result=await services.payments.entitlements.issueCoupon(event.id,c.req.valid('json'));
  return result.kind==='refused'?apiError(c,409,'coupon_unavailable','This coupon could not be issued.'):c.json(result,201);
 })
 .get('/api/public/book/:handle/:slug/products',validate('param',publicEvent),async c=>{
  const {handle,slug}=c.req.valid('param'),services=c.get('services');
  const profile=await services.hostProfile.getPublicProfile(handle);
  const event=profile?await services.eventTypes.resolvePublishedEventForPublicRequest(slug):undefined;
  if(!event||event.status!=='published')return apiError(c,404,'event_not_available','This event type is not available.');
  return c.json(await services.payments.entitlements.products(event.id));
 })
 .post('/api/public/book/:handle/:slug/credit',validate('param',publicEvent),validate('json',z.object({email:z.string().trim().email().max(320),code:z.string().min(1).max(200).optional(),durationMinutes:z.number().int().min(5).max(480).optional()}).strict()),async c=>{
  const {handle,slug}=c.req.valid('param'),services=c.get('services'),input=c.req.valid('json');
  const profile=await services.hostProfile.getPublicProfile(handle);
  const event=profile?await services.eventTypes.resolvePublishedEventForPublicRequest(slug):undefined;
  if(!event||event.status!=='published')return apiError(c,404,'event_not_available','This event type is not available.');
  const quote=await services.payments.quote(event.id,input.durationMinutes??event.durationMinutes);
  const approval=await services.bookings.approvalSettings(event.id);
  if(!quote||quote.kind!=='available'||quote.saveCard||quote.taxRequired||approval?.required)return apiError(c,409,'credit_payment_terms_unsupported','Appointment credits cannot be used with these payment terms.');
  const result=await services.payments.entitlements.resolve(event.id,input.email,input.code,quote.snapshot.priceCents);
  if(result.kind==='refused')return apiError(c,409,result.reason,`${result.reason==="credit_remainder_below_minimum"?"Stripe requires a remaining payment of at least $0.50. Use another credit or remove it. ":""}This appointment credit cannot be used. Remaining balance: ${result.balance}.${result.expiresAt?` Expired: ${result.expiresAt}.`:""}`,[String(result.balance),...(result.expiresAt?[result.expiresAt]:[])]);
  return c.json({kind:result.kind,entitlement:result.entitlement,discountCents:result.discountCents,dueNowCents:result.dueNowCents});
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
