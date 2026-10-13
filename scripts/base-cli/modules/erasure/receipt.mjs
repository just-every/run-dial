import { statement, canonicalJson, insist } from './sql.mjs';

const parse = row => row && ({
  id: row.id, entity: row.entity, phase: row.phase, label: row.label,
  planned: JSON.parse(row.planned), deleted: JSON.parse(row.deleted), retained: JSON.parse(row.retained),
  blobs: { total: row.blobs_total, deleted: row.blobs_deleted },
  requestedAt: row.requested_at, committedAt: row.committed_at, completedAt: row.completed_at,
  seconds: row.completed_at ? (Date.parse(row.completed_at) - Date.parse(row.requested_at)) / 1000 : null,
});

export async function receipt(db, id) {
  const row = await statement(db, 'SELECT * FROM rer_erasure_operations WHERE id=?', id).first();
  insist(row, 'erasure_not_found', 404);
  return parse(row);
}
export async function activeFor(db, d, subject) {
  return parse(await statement(db, "SELECT * FROM rer_erasure_operations o WHERE entity=? AND (subject=? OR (?=1 AND phase='blobs' AND EXISTS(SELECT 1 FROM rer_erasure_scope s WHERE s.operation=o.id AND s.kind='graph' AND s.table_name=? AND s.key_json=?)))", d.entity, canonicalJson(subject), Number(Boolean(d.root.redact)), d.root.table, canonicalJson(subject)).first());
}
/** The subject key is held only while rows are still being deleted. */
export function openStatement(db, d, { id, subject, label, planned, blobs, now }) {
  return statement(db, 'INSERT INTO rer_erasure_operations(id,entity,subject,label,phase,planned,retained,blobs_total,requested_at) VALUES(?,?,?,?,?,?,?,?,?)',
    id, d.entity, canonicalJson(subject), label, 'deleting', canonicalJson(planned), canonicalJson([...d.retain.map(({ table, reason }) => ({ table, reason })), ...(d.root.redact ? [{ table: d.root.table, reason: d.root.redact.reason }] : [])]), blobs, now);
}
export function progressStatement(db, id, step, deleted) {
  return statement(db, 'UPDATE rer_erasure_operations SET step=step+1,deleted=? WHERE id=? AND step=?', canonicalJson(deleted), id, step);
}
export function committedStatement(db, id, now) {
  return statement(db, "UPDATE rer_erasure_operations SET phase='blobs',subject=NULL,committed_at=? WHERE id=? AND phase='deleting'", now, id);
}
export function completeStatement(db, id, now) {
  return statement(db, "UPDATE rer_erasure_operations SET phase='complete',completed_at=? WHERE id=? AND phase='blobs' AND NOT EXISTS(SELECT 1 FROM rer_erasure_blobs WHERE operation=?)", now, id, id);
}
