import { Hono } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError, readLimitedBody } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { createCredential, hashSecret, type CredentialScope } from "./store";

// Applications use an owner-issued machine grant; this door cannot mint a session or delegate a person's authority.
export const credentialOAuthRoutes = new Hono<AppEnvironment>().post("/api/oauth/token",async context => {
  context.header("Cache-Control","no-store");
  context.header("Pragma","no-cache");
  if (context.req.header("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return apiError(context,400,"invalid_request","Use form-encoded OAuth credentials.");
  const body=await readLimitedBody(context.req.raw,4096);
  if(!body) return apiError(context,413,"request_too_large","The token request is too large.");
  const input=new URLSearchParams(new TextDecoder().decode(body));
  if(input.get("grant_type")!=="client_credentials") return apiError(context,400,"unsupported_grant_type","Only an explicitly owner-issued client credentials grant is supported.");
  if([...input.keys()].some(key=>!["grant_type","client_id","client_secret","scope"].includes(key))) return apiError(context,400,"invalid_request","The token request contains unsupported fields.");
  const id=input.get("client_id") ?? "",secret=input.get("client_secret") ?? "";
  if(!/^[a-f0-9]{64}$/.test(secret)) return apiError(context,401,"invalid_client","A valid application credential is required.");
  const now=nowIso();
  const app=await context.get("apiDatabase").prepare(`SELECT a.id,a.name,a.operator_id,a.host_id,a.team_id,a.scopes_json,a.expires_at
    FROM api_oauth_applications a JOIN oa_operators o ON o.id=a.operator_id
    WHERE a.id=? AND a.client_secret_hash=? AND a.workspace_id='default' AND a.revoked_at IS NULL AND a.expires_at>?
    AND o.role='owner' AND o.status='active'`).bind(id,await hashSecret(secret),now)
    .first<{id:string;name:string;operator_id:string;host_id:string|null;team_id:string|null;scopes_json:string;expires_at:string}>();
  if(!app) return apiError(context,401,"invalid_client","A valid application credential is required.");
  const allowed=JSON.parse(app.scopes_json) as CredentialScope[];
  const requested=input.get("scope")?.split(/\s+/).filter(Boolean) ?? allowed;
  if(!requested.length || requested.some(scope=>!allowed.includes(scope as CredentialScope))) return apiError(context,400,"invalid_scope","The requested scope exceeds this application's grant.");
  const expiresAt=new Date(Math.min(Date.now()+60*60*1000,Date.parse(app.expires_at))).toISOString();
  const result=await createCredential(context.get("apiDatabase"),{name:app.name,scopes:[...new Set(requested)] as CredentialScope[],
    ...(app.host_id?{hostId:app.host_id}:{}),...(app.team_id?{teamId:app.team_id}:{}),expiresAt},app.operator_id,app.id);
  return context.json({ access_token:result.secret,token_type:"Bearer",expires_in:Math.max(0,Math.floor((Date.parse(expiresAt)-Date.now())/1000)),scope:requested.join(" ") });
});
