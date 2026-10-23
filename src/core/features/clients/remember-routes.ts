import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
const event=z.object({handle:z.string().regex(/^[a-z0-9-]+$/).max(80),slug:z.string().regex(/^[a-z0-9-]+$/).max(80)});
export const rememberRoutes=new Hono<AppEnvironment>()
  .use("/api/public/book/*/remember/*",async(c,next)=>{c.header("Cache-Control","private, no-store");c.header("Referrer-Policy","no-referrer");await next();})
  .post("/api/public/book/:handle/:slug/remember/request",validate("param",event),validate("json",z.object({email:z.string().trim().email().max(320)}).strict()),async c=>{
    const {handle,slug}=c.req.valid("param");
    await c.get("services").rememberedDetails.request(handle,slug,c.req.valid("json").email);
    return c.json({accepted:true},202);
  })
  .post("/api/public/book/:handle/:slug/remember/redeem",validate("param",event),validate("json",z.object({token:z.string().max(200)}).strict()),async c=>{
    const {handle,slug}=c.req.valid("param"),result=await c.get("services").rememberedDetails.redeem(handle,slug,c.req.valid("json").token);
    return result?c.json(result):apiError(c,404,"remember_link_not_found","This saved-details link is unavailable. Enter your details to book.");
  });
