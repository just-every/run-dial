import { createId, nowIso } from "../src/core/shared/ids";
/** Test-only identities: runtime tests exercise actual Base capabilities separately. */
export async function ensureTestOperator(binding: D1Database, email: string) {
  const normalized = email.trim().toLowerCase();
  await binding.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES(?,?,?,'owner','active',?) ON CONFLICT(email) DO NOTHING")
    .bind(createId(), normalized, normalized, Date.now()).run();
  const operator = await binding.prepare("SELECT id,email FROM oa_operators WHERE email=?").bind(normalized).first<{ id: string; email: string }>();
  if (!operator) throw new Error("Missing test operator");
  return operator;
}
export async function registerTestSetup(binding: D1Database, id: string) {
  await binding.prepare("INSERT INTO operator_setup_identity(singleton_key,operator_id,created_at,onboarding_completed_at) VALUES('default',?,?,?) ON CONFLICT DO NOTHING").bind(id, nowIso(), nowIso()).run();
}
