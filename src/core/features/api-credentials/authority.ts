import type { Context } from "hono";
import type { AppEnvironment } from "../../app/context";
import { createId, nowIso } from "../../shared/ids";
import { apiError } from "../../shared/http";

export async function credentialAdministrator(db: D1Database, id: string) {
  return Boolean(await db.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')").bind(id).first());
}
export async function auditCredential(db: D1Database, actor: string, action: string, subject: string) {
  const now=nowIso();
  await db.prepare("INSERT INTO api_credential_audit(id,actor_id,action,subject_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(createId(),actor,action,subject,now,now).run();
}
export async function apiHosts(db: D1Database) {
  return (await db.prepare(`SELECT p.id,p.name,s.operator_id AS operatorId FROM host_profiles p
    LEFT JOIN operator_setup_identity s ON s.singleton_key='default' WHERE p.singleton_key='default'
    UNION ALL SELECT h.id,o.display_name AS name,h.operator_id AS operatorId FROM api_hosts h
    JOIN oa_operators o ON o.id=h.operator_id WHERE o.status='active' ORDER BY id`).all<{id:string;name:string;operatorId:string|null}>()).results;
}
export async function hostExists(db: D1Database, id: string) { return (await apiHosts(db)).some(host=>host.id===id); }
export async function requireCredentialAdmin(c: Context<AppEnvironment>) {
  if(!await credentialAdministrator(c.get("apiDatabase"),c.get("session").id))return apiError(c,403,"role_forbidden","Only an owner or admin can manage API credentials.");
}
