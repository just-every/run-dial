import type { Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { apiError, discardRequestBody } from "../../shared/http";
import { nowIso } from "../../shared/ids";
import { credentialRecord, hashSecret, type CredentialRow, type CredentialScope } from "./store";
export type { Credential } from "./store";
import type { Credential } from "./store";

export async function authenticateCredential(context: Context<AppEnvironment>): Promise<Credential | Response> {
  const authorization = context.req.header("Authorization") ?? "";
  const match = /^Bearer ([a-f0-9]{64})$/.exec(authorization);
  const refused = async (code: string) => {
    await discardRequestBody(context.req.raw);
    return apiError(context, 401, code, "A valid API credential is required.");
  };
  if (!match) return refused("invalid_credential");
  const db = context.env.DB;
  const row = await db.prepare("SELECT * FROM api_credentials WHERE secret_hash=? AND workspace_id='default'")
    .bind(await hashSecret(match[1])).first<CredentialRow>();
  if (!row) return refused("invalid_credential");
  const now = nowIso();
  if (row.revoked_at) return refused("credential_revoked");
  if (row.expires_at <= now) return refused("credential_expired");
  const authority = await db.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='owner'")
    .bind(row.operator_id).first();
  if (!authority) return refused("credential_revoked");
  if (row.oauth_application_id) {
    const app = await db.prepare("SELECT id FROM api_oauth_applications WHERE id=? AND operator_id=? AND revoked_at IS NULL AND expires_at>?")
      .bind(row.oauth_application_id,row.operator_id,now).first();
    if (!app) return refused("credential_revoked");
  }
  const used = await db.prepare("UPDATE api_credentials SET last_used_at=?,updated_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>?")
    .bind(now,now,row.id,now).run();
  if (!used.meta.changes) return refused("credential_revoked");
  return credentialRecord({ ...row, last_used_at: now });
}

export async function requireScope(context: Context<AppEnvironment>, credential: Credential, scope: string): Promise<Response | undefined> {
  if (credential.scopes.includes(scope as CredentialScope)) return;
  await discardRequestBody(context.req.raw);
  return apiError(context, 403, "scope_forbidden", "This API credential does not allow that action.");
}
