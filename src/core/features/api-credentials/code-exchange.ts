import type { Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { createCredential, hashSecret, type CredentialScope } from "./store";

export async function exchangeCode(c:Context<AppEnvironment>,input:URLSearchParams) {
 const invalid=()=>apiError(c,400,"invalid_grant","This authorization code is unavailable.");
 const secret=input.get("client_secret")??"",code=input.get("code")??"",verifier=input.get("code_verifier")??"";
 if(!/^[a-f0-9]{64}$/.test(secret)||!/^[a-f0-9]{64}$/.test(code)||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return invalid();
 const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
 const now=nowIso(),db=c.get("apiDatabase");
 const grant=await db.prepare(`SELECT g.id,g.application_id,g.operator_id,g.host_id,g.team_id,g.scopes_json,g.expires_at,a.name
  FROM api_oauth_codes code JOIN api_oauth_grants g ON g.id=code.grant_id JOIN api_oauth_applications a ON a.id=g.application_id
  JOIN oa_operators issuer ON issuer.id=a.operator_id JOIN oa_operators person ON person.id=g.operator_id
  WHERE code.code_hash=? AND code.challenge=? AND code.redirect_uri=? AND code.consumed_at IS NULL AND code.expires_at>?
  AND a.id=? AND a.client_secret_hash=? AND a.redirect_uri=code.redirect_uri AND a.grant_type='authorization_code'
  AND a.revoked_at IS NULL AND a.expires_at>? AND g.revoked_at IS NULL AND g.expires_at>?
  AND issuer.status='active' AND issuer.role IN ('owner','admin') AND person.status='active' AND person.role='owner'`)
  .bind(await hashSecret(code),challenge,input.get("redirect_uri")??"",now,input.get("client_id")??"",await hashSecret(secret),now,now)
  .first<{id:string;application_id:string;operator_id:string;host_id:string|null;team_id:string|null;scopes_json:string;expires_at:string;name:string}>();
 if(!grant)return invalid();
 const claimed=await db.prepare("UPDATE api_oauth_codes SET consumed_at=?,updated_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?").bind(now,now,await hashSecret(code),now).run();
 if(!claimed.meta.changes)return invalid();
 const expiresAt=new Date(Math.min(Date.now()+3600000,Date.parse(grant.expires_at))).toISOString();
 const result=await createCredential(db,{name:grant.name,scopes:JSON.parse(grant.scopes_json) as CredentialScope[],expiresAt,
  ...(grant.host_id?{hostId:grant.host_id}:{}),...(grant.team_id?{teamId:grant.team_id}:{})},grant.operator_id,grant.application_id,grant.id);
 return c.json({access_token:result.secret,token_type:"Bearer",expires_in:Math.max(0,Math.floor((Date.parse(expiresAt)-Date.now())/1000)),scope:result.credential.scopes.join(" ")});
}
