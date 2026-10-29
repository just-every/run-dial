import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError, discardRequestBody } from "../../shared/http";
import { auditCredential } from "../api-credentials";
import { WorkflowCrmErasure } from "./crm-erasure";
import { CrmFailure } from "./crm-provider";

const input=z.object({name:z.string().trim().min(1).max(120),accessToken:z.string().min(1).max(4096).refine(value=>!/[\r\n]/.test(value)),consent:z.literal(true)}).strict();
export const workflowCrmRoutes=new Hono<AppEnvironment>()
 .use("/api/app/workflow-crm-connections*",async(c,next)=>{
  const owner=await c.get("apiDatabase").prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(c.get("session").id).first();
  if(!owner){await discardRequestBody(c.req.raw);return apiError(c,403,"role_forbidden","Only an owner can authorize CRM workflow delivery.");}
  c.header("Cache-Control","no-store");await next();
 })
 .get("/api/app/workflow-crm-connections",async c=>c.json({connections:await c.get("services").workflowCrm.connections.list(),cleanup:await WorkflowCrmErasure.items(c.get("apiDatabase"))}))
 .post("/api/app/workflow-crm-connections",validate("json",input),async c=>{
  try{
   const connection=await c.get("services").workflowCrm.connections.connect(c.req.valid("json"),c.get("session").id);
   if(!connection)throw new Error("crm_connection_missing");
   await auditCredential(c.get("apiDatabase"),c.get("session").id,"workflow_crm_connected",connection.id);
   return c.json(connection,201);
  }catch(error){if(error instanceof CrmFailure)return apiError(c,422,error.code,"HubSpot requires contact read and write access and the three documented Dial text properties. No workflow connection was enabled.");throw error;}
 })
 .delete("/api/app/workflow-crm-connections/:id",async c=>{
  const revoked=await c.get("services").workflowCrm.connections.revoke(c.req.param("id"));
  if(revoked)await auditCredential(c.get("apiDatabase"),c.get("session").id,"workflow_crm_revoked",c.req.param("id"));
  return revoked?c.json({revoked:true}):apiError(c,404,"not_found","This workflow connection does not exist.");
 });
