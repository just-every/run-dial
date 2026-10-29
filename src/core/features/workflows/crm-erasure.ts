import { createId, nowIso } from "../../shared/ids";

const reason="hubspot_properties_require_owner_cleanup";
/** No automatic destructive provider action or unverifiable deletion claim. */
export class WorkflowCrmErasure {
 static async preview(db:D1Database,email:string){
  const rows=(await db.prepare(`SELECT DISTINCT r.connection_id AS accountId,r.contact_id AS processorRef FROM workflow_crm_runs r
   JOIN bookings b ON b.id=r.booking_id WHERE b.invitee_email_folded=? AND r.contact_id IS NOT NULL`).bind(email).all<{accountId:string|null;processorRef:string}>()).results;
  return rows.map(row=>({kind:"hubspot_booking_properties" as const,accountId:row.accountId??"revoked",processorRef:row.processorRef,state:"pending" as const,reason,requested:false}));
 }
 static async prepare(db:D1Database,email:string,receiptId:string){
  const runs=(await db.prepare(`SELECT r.id,r.connection_id,r.contact_id FROM workflow_crm_runs r JOIN bookings b ON b.id=r.booking_id
   WHERE b.invitee_email_folded=? AND r.contact_id IS NOT NULL`).bind(email).all<{id:string;connection_id:string|null;contact_id:string}>()).results;
  for(const run of runs)await db.prepare("INSERT OR IGNORE INTO workflow_crm_erasure_requests(id,receipt_id,source_run_id,connection_id,contact_id,reason,created_at) VALUES(?,?,?,?,?,?,?)")
   .bind(createId(),receiptId,run.id,run.connection_id,run.contact_id,reason,nowIso()).run();
 }
 static async items(db:D1Database,receiptId?:string){
  const rows=(await db.prepare(`SELECT id,connection_id AS accountId,contact_id AS processorRef,reason FROM workflow_crm_erasure_requests
   WHERE (? IS NULL OR receipt_id=?) ORDER BY created_at,id`).bind(receiptId??null,receiptId??null).all<{id:string;accountId:string|null;processorRef:string;reason:string}>()).results;
  return rows.map(row=>({...row,accountId:row.accountId??"revoked",kind:"hubspot_booking_properties" as const,state:"pending" as const,requested:false}));
 }
}
