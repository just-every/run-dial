import { ErasureError } from "../../../modules/erasure/index.mjs";
import { nowIso } from "../../shared/ids";

/** Close archive admission before graph discovery, so invalidation cannot miss
 * a newly-created snapshot. A failed erasure stays resumable under this lock. */
export async function admitErasure(db: D1Database, email: string, session: { id: string; sessionId: string }) {
  await requireErasureSession(db,session);
  try {
    const authority = erasureAuthority(session);
    const result = await db.batch([
      db.prepare(authority.sql).bind(...authority.params),
      db.prepare("INSERT INTO rer_erasure_guard(value) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rer_portability_state WHERE applying=1) THEN 1 ELSE 0 END"),
      db.prepare("INSERT INTO person_erasure_locks(email,requested_at) VALUES(?,?) ON CONFLICT(email) DO NOTHING").bind(email, nowIso()),
      db.prepare("DELETE FROM rer_erasure_guard"),
      db.prepare(authority.sql).bind(...authority.params),
    ]);
    return result[2].meta.changes > 0;
  } catch (error) {
    if (String(error).includes("CHECK constraint failed")) throw new ErasureError("archive_restore_in_progress", 409);
    throw error;
  }
}

const nativeAuthority = `SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
  WHERE s.id=? AND o.id=? AND s.revoked_at IS NULL AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
  AND o.status='active' AND s.operator_version=o.version AND s.kind<>'dev'
  AND NOT EXISTS(SELECT 1 FROM oa_dev_credentials d WHERE d.credential='oa_sessions' AND d.id=s.id)`;

/** Local development personas do not grant production destructive authority. */
export async function requireErasureSession(db: D1Database, session: { id: string; sessionId: string }) {
  if (!await db.prepare(nativeAuthority).bind(session.sessionId,session.id).first()) throw new ErasureError("native_session_required",403);
}

/** Repeat at the last statement, using commit-time native time after custody cleanup. */
export function erasureAuthority(session: { id: string; sessionId: string }) {
  return { sql: `SELECT CASE WHEN EXISTS(${nativeAuthority}) THEN 1 ELSE abs(-9223372036854775808) END`, params: [session.sessionId, session.id] };
}
