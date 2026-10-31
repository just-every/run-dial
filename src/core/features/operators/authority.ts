import { AuthError } from "../../../../modules/operator-auth/index.mjs";

/** The current product boundary, shared by person and agent commands. */
export async function requireNativeOwner(db: D1Database, id: string) {
  const operator = await db.prepare("SELECT id,email,display_name AS name,role,status FROM oa_operators WHERE id=?")
    .bind(id).first<{ id: string; email: string; name: string; role: string; status: string }>();
  if (!operator || operator.status !== "active") throw new AuthError("unauthenticated", 401);
  if (operator.role !== "owner") throw new AuthError("role_forbidden", 403);
  return operator;
}
