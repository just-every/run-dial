import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { validate } from "../../shared/validation";
import { providerSchema,tagsSchema,googleConnectionSchema,linkedinConnectionSchema } from "./types";

export const analyticsRoutes=new Hono<AppEnvironment>()
  .get('/api/public/analytics',async c=>{c.header('cache-control','no-store');return c.json(await c.get('services').analytics.settings.tags());})
  .use('/api/app/analytics*',async(c,next)=>{
    const session=await c.get('services').operators.auth.getSession(c.req.raw);
    if(!session || session.operator.role!=='owner')return apiError(c,403,'role_forbidden','Owner authorization is required for workspace analytics.');
    c.header('cache-control','no-store, private');await next();
  })
  .get('/api/app/analytics',async c=>c.json(await c.get('services').analytics.settings.tags()))
  .put('/api/app/analytics',validate('json',tagsSchema),async c=>c.json(await c.get('services').analytics.settings.saveTags(c.req.valid('json'))))
  .get('/api/app/analytics/connections',async c=>c.json(await c.get('services').analytics.settings.connections()))
  .put('/api/app/analytics/connections/:provider',validate('param',z.object({provider:providerSchema})),async c=>{
    const provider=c.req.valid('param').provider;
    const raw=await c.req.json().catch(()=>null);
    if(provider==='google_ads') {const parsed=googleConnectionSchema.safeParse(raw);return parsed.success?c.json(await c.get('services').analytics.settings.connect(provider,parsed.data)):apiError(c,400,'invalid_request','Enter valid Google Ads account and conversion credentials.');}
    const parsed=linkedinConnectionSchema.safeParse(raw);return parsed.success?c.json(await c.get('services').analytics.settings.connect(provider,parsed.data)):apiError(c,400,'invalid_request','Enter valid LinkedIn account and conversion credentials.');
  })
  .delete('/api/app/analytics/connections/:provider',validate('param',z.object({provider:providerSchema})),async c=>c.json(await c.get('services').analytics.settings.disconnect(c.req.valid('param').provider)));
