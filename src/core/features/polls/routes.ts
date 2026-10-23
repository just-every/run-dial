import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { pollInput } from "./types";
const params=z.object({id:z.string().regex(/^[0-9A-Z]{26}$/)}),token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const pollRoutes=new Hono<AppEnvironment>()
 .get("/api/app/polls",async c=>{c.header("Cache-Control","private, no-store");return c.json(await c.get("services").polls.repository.list());})
 .get("/api/app/polls/:id",validate("param",params),async c=>{c.header("Cache-Control","private, no-store");const result=await c.get("services").polls.host(c.req.valid("param").id);return result?c.json(result):apiError(c,404,"poll_unavailable","This poll is unavailable.");})
 .post("/api/app/polls",validate("json",pollInput),async c=>{c.header("Cache-Control","private, no-store");await c.get("services").operators.requireMutation(c.req.raw);const result=await c.get("services").polls.create(c.req.valid("json"));return result?c.json(result,201):apiError(c,409,"poll_refused","Choose distinct live times before expiry and unique participants. Polls require an unpriced, unapproved published event type.");})
 .post("/api/app/polls/:id/tally",validate("param",params),validate("json",z.object({show:z.boolean()}).strict()),async c=>{await c.get("services").operators.requireMutation(c.req.raw);const result=await c.get("services").polls.repository.settings(c.req.valid("param").id,c.req.valid("json").show);return result?c.json({updated:true}):apiError(c,404,"poll_unavailable","This poll is unavailable.");})
 .post("/api/app/polls/:id/close",validate("param",params),async c=>{await c.get("services").operators.requireMutation(c.req.raw);await c.get("services").polls.repository.close(c.req.valid("param").id);return c.json({closed:true});})
 .get("/api/public/polls/:id",validate("param",params),validate("query",z.object({token})),async c=>{c.header("Cache-Control","private, no-store");c.header("Referrer-Policy","no-referrer");const result=await c.get("services").polls.read(c.req.valid("param").id,c.req.valid("query").token);return result?c.json(result):apiError(c,404,"poll_unavailable","This poll link is unavailable.");})
 .post("/api/public/polls/:id/votes",validate("param",params),validate("json",z.object({token,votes:z.array(z.object({candidateId:z.string(),choice:z.enum(["yes","if_needed","no"])}).strict()).min(2).max(12)}).strict()),async c=>{c.header("Cache-Control","private, no-store");c.header("Referrer-Policy","no-referrer");const input=c.req.valid("json"),next=await c.get("services").polls.vote(c.req.valid("param").id,input.token,input.votes);return next?c.json({token:next}):apiError(c,404,"poll_unavailable","This poll link or one of its candidate times is unavailable.");});
