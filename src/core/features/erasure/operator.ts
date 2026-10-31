import { createErasure } from "../../../modules/erasure/index.mjs";
import { AuthError } from "../../../../modules/operator-auth/index.mjs";
import { erasurePortability } from "./portability";
import { admitErasure, erasureAuthority } from "./admission";
import { addressRemainders, deleteRows } from "./address";
import { foldEmail, emailFoldSql } from "./identity";
import { operatorGraph } from "./operator-graph";
import { nowIso } from "../../shared/ids";

/** Base has already authorized and revoked access inside the notification gate.
 * Keep anonymous author references only where unrelated authored facts need them. */
export async function eraseRemovedOperator(db:D1Database,target:{id:string;email:string},actor:{id:string;sessionId:string},secret:string) {
  if(target.id===actor.id)throw new AuthError("self_erasure",409);
  const protectedOwner=await db.prepare("SELECT 1 FROM operator_setup_identity WHERE operator_id=? UNION ALL SELECT 1 FROM oa_bootstrap WHERE claim_id=? LIMIT 1").bind(target.id,target.id).first();
  if(protectedOwner)throw new AuthError("setup_operator_erasure_hold",409);
  const retainNative = Boolean(await db.prepare("SELECT 1 FROM oa_domain_rules WHERE created_by=? UNION ALL SELECT 1 FROM operator_erasure_subjects WHERE id=? LIMIT 1").bind(target.id,target.id).first());
  const fence=await erasurePortability(db);
  const email=foldEmail(target.email);
  await admitErasure(db,email,actor);
  const authority = erasureAuthority(actor);
  await db.batch([
    db.prepare(authority.sql).bind(...authority.params),
    ...(retainNative ? [db.prepare("INSERT INTO operator_erasure_subjects(id) SELECT id FROM oa_operators WHERE id=? AND status='inactive' ON CONFLICT DO NOTHING").bind(target.id)] : []),
    // An accepted invitation grants the recipient independent native authority.
    // Detach that session's provenance before graph discovery: erasing its
    // inviter must erase the invitation, not the recipient's live session.
    // Base has already deactivated the issuer, so no invitation can now join.
    db.prepare("UPDATE oa_sessions SET source_token_id=NULL WHERE operator_id<>? AND source_token_id IN (SELECT id FROM oa_tokens WHERE issuer_id=?)").bind(target.id,target.id),
    db.prepare(authority.sql).bind(...authority.params),
  ]);
  const graph = operatorGraph(retainNative);
  const engine=createErasure({db,portability:fence,declarations:[graph]});
  const plan=await engine.nativeStatements(retainNative ? "operator-author" : "operator",{id:target.id});
  const now=nowIso();
  const statements=[erasureAuthority(actor),
    {sql:`INSERT INTO rer_erasure_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='inactive') AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active') AND (? OR NOT EXISTS(SELECT 1 FROM oa_domain_rules WHERE created_by=?)) AND NOT EXISTS(SELECT 1 FROM bookings WHERE invitee_email_folded=?) AND NOT EXISTS(SELECT 1 FROM availability_requests WHERE ${emailFoldSql("invitee_email")}=?) THEN 1 ELSE 0 END`,params:[target.id,actor.id,retainNative ? 1 : 0,target.id,email,email]},
    // The helper re-reads its planned rows first; address cleanup that overlaps them runs after.
    {sql:"UPDATE api_hosts SET operator_id=NULL,updated_at=? WHERE operator_id=?",params:[now,target.id]},
    ...plan.statements,
    ...await addressRemainders(db,fence,email,secret,[target.email]),
    ...(retainNative ? [{ sql: "UPDATE oa_operators SET email='erased:'||id,display_name='Removed operator',version=version+1 WHERE id=? AND status='inactive'", params: [target.id] }] : []),
    {sql:"UPDATE operators SET email='erased:'||id,normalized_email='erased:'||id,erased_at=?,updated_at=? WHERE id=? AND removed_at IS NOT NULL",params:[now,now,target.id]},
    // A connected shared calendar remains usable; the author reference is no
    // longer an identity, and its public account label need not carry that email.
    {sql:`UPDATE calendar_connections SET account_email=NULL WHERE ${emailFoldSql("account_email") }=?`,params:[email]},
    {sql:"UPDATE anonymized_audit SET actor_id=NULL WHERE actor_id=?",params:[target.id]},
    ...await deleteRows(db,fence,"person_erasure_locks","email=? AND receipt_id IS NULL",[email]),
    {sql:"DELETE FROM rer_erasure_guard",params:[]}, erasureAuthority(actor),
  ];
  await db.batch(statements.map(statement=>db.prepare(statement.sql).bind(...statement.params)));
  await engine.deleteBlobs(plan.operationId);
}
