import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { createId, nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { credentialAdministrator, auditCredential, hostExists } from "./authority";
import { credentialScopes, hashSecret, randomSecret, type CredentialScope } from "./store";

const consentInput=z.object({client_id:z.string().length(26),redirect_uri:z.string().url().max(2000),response_type:z.literal("code"),
 scope:z.string().max(1000),state:z.string().min(16).max(512),code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal("S256")}).strict();
const decision=consentInput.extend({approve:z.boolean()});
type ConsentInput=z.infer<typeof consentInput>;
export type Application={id:string;name:string;operator_id:string;host_id:string|null;team_id:string|null;scopes_json:string;expires_at:string;redirect_uri:string};
export async function activeApplication(db:D1Database,id:string) {
 return db.prepare(`SELECT a.* FROM api_oauth_applications a JOIN oa_operators o ON o.id=a.operator_id
   WHERE a.id=? AND a.grant_type='authorization_code' AND a.revoked_at IS NULL AND a.expires_at>?
   AND o.status='active' AND o.role IN ('owner','admin')`).bind(id,nowIso()).first<Application>();
}
async function review(db:D1Database,input:ConsentInput,operatorId:string) {
 const app=await activeApplication(db,input.client_id);
 if(!app||app.redirect_uri!==input.redirect_uri)return;
 if(!await credentialAdministrator(db,operatorId))return;
 if(app.host_id&&!await hostExists(db,app.host_id))return;
 const scopes=[...new Set(input.scope.split(/\s+/).filter(Boolean))] as CredentialScope[];
 const allowed=JSON.parse(app.scopes_json) as CredentialScope[];
 if(!scopes.length||scopes.some(scope=>!credentialScopes.includes(scope)||!allowed.includes(scope)))return;
 return {app,scopes};
}
export const consentRoutes=new Hono<AppEnvironment>()
 .get("/api/app/oauth/authorize",validate("query",consentInput),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");
  const value=await review(c.get("apiDatabase"),c.req.valid("query"),c.get("session").id);
  return value?c.json({application:{id:value.app.id,name:value.app.name,redirectUri:value.app.redirect_uri,hostId:value.app.host_id,teamId:value.app.team_id,expiresAt:value.app.expires_at},scopes:value.scopes}):apiError(c,400,"invalid_authorization_request","This application or requested grant is unavailable.");
 })
 .post("/api/app/oauth/authorize",validate("json",decision),async c=>{
  c.header("Cache-Control","no-store");c.header("Referrer-Policy","no-referrer");
  if(c.req.header("Origin")!==new URL(c.get("runtime").APP_URL).origin)return apiError(c,403,"origin_not_allowed","Approve from this installation.");
  const input=c.req.valid("json"),db=c.get("apiDatabase"),actor=c.get("session").id;
  const value=await review(db,input,actor);
  if(!value)return apiError(c,400,"invalid_authorization_request","This application or requested grant is unavailable.");
  const redirect=new URL(value.app.redirect_uri);redirect.searchParams.set("state",input.state);
  if(!input.approve){redirect.searchParams.set("error","access_denied");return c.json({redirectUrl:redirect.href});}
  const code=randomSecret(),now=nowIso(),grantId=createId();
  await db.batch([
   db.prepare("INSERT INTO api_oauth_grants(id,application_id,operator_id,scopes_json,host_id,team_id,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(grantId,value.app.id,actor,JSON.stringify(value.scopes),value.app.host_id,value.app.team_id,value.app.expires_at,now,now),
   db.prepare("INSERT INTO api_oauth_codes(id,grant_id,code_hash,challenge,redirect_uri,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(createId(),grantId,await hashSecret(code),input.code_challenge,value.app.redirect_uri,new Date(Math.min(Date.now()+5*60000,Date.parse(value.app.expires_at))).toISOString(),now,now),
  ]);
  await auditCredential(db,actor,"consent_approved",grantId);
  redirect.searchParams.set("code",code);
  return c.json({redirectUrl:redirect.href});
 })
 .get("/api/app/oauth/grants",async c=>{
  c.header("Cache-Control","no-store");
  const grants=(await c.get("apiDatabase").prepare(`SELECT g.id,a.name,g.scopes_json,g.host_id AS hostId,g.team_id AS teamId,g.expires_at AS expiresAt,g.revoked_at AS revokedAt
    FROM api_oauth_grants g JOIN api_oauth_applications a ON a.id=g.application_id WHERE g.operator_id=? ORDER BY g.created_at,g.id`).bind(c.get("session").id).all<{scopes_json:string}>()).results;
  return c.json({grants:grants.map(({scopes_json,...row})=>({...row,scopes:JSON.parse(scopes_json)}))});
 })
 .post("/api/app/oauth/grants/:id/revoke",async c=>{
  const db=c.get("apiDatabase"),id=c.req.param("id"),actor=c.get("session").id,now=nowIso();
  const result=await db.prepare("UPDATE api_oauth_grants SET revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE id=? AND operator_id=?").bind(now,now,id,actor).run();
  if(!result.meta.changes)return apiError(c,404,"grant_not_found","This connected app is unavailable.");
  await auditCredential(db,actor,"consent_revoked",id);
  return c.body(null,204);
 });
