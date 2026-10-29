import { createId, nowIso } from "../../shared/ids";

export const credentialScopes = ["bookings:read", "bookings:write", "event-types:manage", "routing:manage", "reports:read", "webhooks:manage"] as const;
export type CredentialScope = typeof credentialScopes[number];
export type Credential = {
  id: string; name: string; operatorId: string; workspaceId: string;
  hostId: string | null; teamId: string | null; scopes: CredentialScope[];
  expiresAt: string; lastUsedAt: string | null;
};
export type CredentialInput = { name: string; scopes: CredentialScope[]; hostId?: string; teamId?: string; expiresAt: string };
export type CredentialRow = {
  id: string; name: string; operator_id: string; workspace_id: string;
  host_id: string | null; team_id: string | null; scopes_json: string;
  expires_at: string; last_used_at: string | null; revoked_at: string | null;
  oauth_application_id: string | null; created_at: string; updated_at: string;
};
export function credentialRecord(row: CredentialRow): Credential {
  return { id: row.id, name: row.name, operatorId: row.operator_id, workspaceId: row.workspace_id,
    hostId: row.host_id, teamId: row.team_id, scopes: JSON.parse(row.scopes_json),
    expiresAt: row.expires_at, lastUsedAt: row.last_used_at };
}
export async function hashSecret(secret: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
export function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function createCredential(db: D1Database, input: CredentialInput, operatorId: string, applicationId?: string) {
  const id = createId(), secret = randomSecret(), now = nowIso();
  await db.prepare(`INSERT INTO api_credentials
    (id,name,operator_id,workspace_id,host_id,team_id,scopes_json,secret_hash,expires_at,oauth_application_id,created_at,updated_at)
    VALUES(?,?,?,'default',?,?,?,?,?,?,?,?)`).bind(id,input.name,operatorId,input.hostId ?? null,input.teamId ?? null,
      JSON.stringify(input.scopes),await hashSecret(secret),input.expiresAt,applicationId ?? null,now,now).run();
  return { credential: { id, name: input.name, operatorId, workspaceId: "default", hostId: input.hostId ?? null,
    teamId: input.teamId ?? null, scopes: input.scopes, expiresAt: input.expiresAt, lastUsedAt: null }, secret };
}
