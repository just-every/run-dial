import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { forwardBookingRequest } from "../../app/booking-coordination";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { ErasureError } from "../../../modules/erasure/index.mjs";

const email=z.object({email:z.string().trim().min(1).max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u)}).strict();
export const personErasureRoutes=new Hono<AppEnvironment>()
  .use("/api/app/privacy/*",async(c,next)=>{c.header("Cache-Control","no-store");await next();})
  .post("/api/app/privacy/preview",validate("json",email),async c=>{
    c.set("inertMutation",true);c.header("Cache-Control","no-store");
    await c.get("services").operators.requireMutation(c.req.raw);
    return c.json(await c.get("services").personErasure.preview(c.req.valid("json").email,c.get("session")));
  })
  .post("/api/app/privacy/erase",validate("json",email.extend({confirmation:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int()}).strict()),async c=>{
    await c.get("services").operators.requireMutation(c.req.raw);
    const receipt=await c.get("services").personErasure.erase(c.req.valid("json"),c.get("session"),async(kind,id)=>{
      const url=new URL(`/api/app/${kind}/${id}`,c.req.url);
      const headers=new Headers(c.req.raw.headers);headers.delete("content-length");headers.delete("content-type");
      const request=new Request(url,{method:"DELETE",headers});
      const response=await forwardBookingRequest(c.env,kind==="bookings"?id:`request:${id}`,request);
      await response.arrayBuffer();
      if(!response.ok)throw new ErasureError("erasure_incomplete",503);
    });
    return c.json(receipt);
  })
  .get("/api/app/privacy/receipts/:id",validate("param",z.object({id:z.string().length(26)})),async c=>{
    c.header("Cache-Control","no-store");
    const result=await c.get("services").personErasure.receipt(c.req.valid("param").id);
    return result?c.json(result):apiError(c,404,"erasure_not_found","The erasure receipt does not exist.");
  });
