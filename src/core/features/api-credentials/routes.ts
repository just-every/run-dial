import { hostExists, requireCredentialAdmin, auditCredential } from "./authority";
import { credentialHostRoutes } from "./host-routes";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { createId, nowIso } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { credentialScopes, credentialRecord, createCredential, hashSecret, randomSecret, type CredentialInput, type CredentialRow } from "./store";

const inputFields = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(credentialScopes)).min(1).max(credentialScopes.length).transform(value => [...new Set(value)]),
  hostId: z.string().length(26).optional(), teamId: z.string().length(26).optional(),
  expiresAt: z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()),
}).strict();
const inputSchema=inputFields.refine(value => !(value.hostId && value.teamId), { message: "Choose one host or one team." });
const applicationSchema=inputFields.extend({grantType:z.enum(["client_credentials","authorization_code"]).default("client_credentials"),redirectUri:z.string().url().max(2000).optional()}).strict().refine(value => !(value.hostId && value.teamId), {message:"Choose one host or one team."}).refine(value=>value.grantType!=="authorization_code"||Boolean(value.redirectUri&&new URL(value.redirectUri).protocol==="https:"&&!new URL(value.redirectUri).hash&&!new URL(value.redirectUri).username&&!new URL(value.redirectUri).password),{message:"Delegated apps require a registered HTTPS redirect without a fragment or credentials."});
const target = z.object({ id: z.string().length(26) });

async function scopeExists(context: Context<AppEnvironment>, input: CredentialInput) {
  if (input.expiresAt <= nowIso()) return apiError(context,400,"invalid_expiry","Choose an expiry in the future.");
  if (input.hostId && !await hostExists(context.get("apiDatabase"),input.hostId)) return apiError(context,404,"host_not_found","The host does not exist.");
  if (input.teamId && !await context.get("apiDatabase").prepare("SELECT id FROM teams WHERE id=?").bind(input.teamId).first()) return apiError(context,404,"team_not_found","The team does not exist.");
}

export const credentialRoutes = new Hono<AppEnvironment>()
  .use("/api/app/api-credentials*",async(c,next)=>{const refusal=await requireCredentialAdmin(c);if(refusal)return refusal;await next();})
  .use("/api/app/oauth-applications*",async(c,next)=>{const refusal=await requireCredentialAdmin(c);if(refusal)return refusal;await next();})
  .route("/",credentialHostRoutes)
  .get("/api/app/api-credentials", async context => {
    context.header("Cache-Control","no-store");
    const rows = (await context.get("apiDatabase").prepare("SELECT * FROM api_credentials ORDER BY created_at,id").all<CredentialRow>()).results;
    return context.json({ credentials: rows.map(row => ({ ...credentialRecord(row), revokedAt: row.revoked_at, createdAt: row.created_at })) });
  })
  .post("/api/app/api-credentials",validate("json",inputSchema),async context => {
    const input = context.req.valid("json"), refusal = await scopeExists(context,input);
    if (refusal) return refusal;
    context.header("Cache-Control","no-store");
    const result=await createCredential(context.get("apiDatabase"),input,context.get("session").id);
    await auditCredential(context.get("apiDatabase"),context.get("session").id,"token_created",result.credential.id);
    return context.json(result,201);
  })
  .post("/api/app/api-credentials/:id/revoke",validate("param",target),async context => {
    const now = nowIso();
    const row = await context.get("apiDatabase").prepare("SELECT id FROM api_credentials WHERE id=?").bind(context.req.valid("param").id).first();
    if (!row) return apiError(context,404,"credential_not_found","The credential does not exist.");
    await context.get("apiDatabase").prepare("UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE id=?")
      .bind(now,now,context.req.valid("param").id).run();
    await auditCredential(context.get("apiDatabase"),context.get("session").id,"token_revoked",context.req.valid("param").id);
    return context.body(null,204);
  })
  .get("/api/app/oauth-applications",async context => {
    context.header("Cache-Control","no-store");
    const rows = (await context.get("apiDatabase").prepare(`SELECT id,name,operator_id AS operatorId,workspace_id AS workspaceId,
      host_id AS hostId,team_id AS teamId,grant_type AS grantType,redirect_uri AS redirectUri,scopes_json,expires_at AS expiresAt,revoked_at AS revokedAt,created_at AS createdAt
      FROM api_oauth_applications ORDER BY created_at,id`).all<{scopes_json:string}>()).results;
    return context.json({ applications: rows.map(({ scopes_json,...row }) => ({ ...row, scopes: JSON.parse(scopes_json) })) });
  })
  .post("/api/app/oauth-applications",validate("json",applicationSchema),async context => {
    const input = context.req.valid("json"), refusal = await scopeExists(context,input);
    if (refusal) return refusal;
    const id=createId(),clientSecret=randomSecret(),now=nowIso();
    await context.get("apiDatabase").prepare(`INSERT INTO api_oauth_applications
      (id,name,operator_id,host_id,team_id,scopes_json,client_secret_hash,expires_at,created_at,updated_at,grant_type,redirect_uri)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,input.name,context.get("session").id,input.hostId ?? null,input.teamId ?? null,
        JSON.stringify(input.scopes),await hashSecret(clientSecret),input.expiresAt,now,now,input.grantType,input.redirectUri??null).run();
    await auditCredential(context.get("apiDatabase"),context.get("session").id,"application_registered",id);
    context.header("Cache-Control","no-store");
    return context.json({ application:{ id,...input,operatorId:context.get("session").id,workspaceId:"default",revokedAt:null,createdAt:now },clientSecret },201);
  })
  .post("/api/app/oauth-applications/:id/revoke",validate("param",target),async context => {
    const id=context.req.valid("param").id,now=nowIso();
    const row=await context.get("apiDatabase").prepare("SELECT id FROM api_oauth_applications WHERE id=?").bind(id).first();
    if(!row) return apiError(context,404,"application_not_found","The application does not exist.");
    await context.get("apiDatabase").batch([
      context.get("apiDatabase").prepare("UPDATE api_oauth_applications SET revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE id=?").bind(now,now,id),
      context.get("apiDatabase").prepare("UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE oauth_application_id=?").bind(now,now,id),
    ]);
    await auditCredential(context.get("apiDatabase"),context.get("session").id,"application_revoked",id);
    return context.body(null,204);
  });
