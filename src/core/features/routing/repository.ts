import { createId, nowIso } from "../../shared/ids";
import type { FormRow, RoutingForm, SubmissionResult } from "./types";

export class RoutingRepository {
 constructor(private readonly db:D1Database) {}
 async list() {
  const rows=(await this.db.prepare("SELECT id,title,host_id AS hostId,config_json AS configJson,created_at AS createdAt,updated_at AS updatedAt FROM routing_forms ORDER BY created_at,id").all<FormRow & {createdAt:string;updatedAt:string}>()).results;
  return rows.map(({configJson,...row})=>({...row,...JSON.parse(configJson) as RoutingForm}));
 }
 async get(id:string) {
  return await this.db.prepare("SELECT id,title,host_id AS hostId,config_json AS configJson FROM routing_forms WHERE id=?").bind(id).first<FormRow>();
 }
 async target(eventId:string,teamId?:string) {
  return this.db.prepare(`SELECT e.slug,p.handle FROM event_types e JOIN host_profiles p ON p.singleton_key='default'
   WHERE e.id=? AND e.status='published' AND (? IS NULL OR EXISTS(SELECT 1 FROM team_event_types m JOIN teams t ON t.id=m.team_id WHERE m.team_id=? AND m.event_type_id=e.id AND t.host_id=p.id))`)
   .bind(eventId,teamId??null,teamId??null).first<{slug:string;handle:string}>();
 }
 async create(input:RoutingForm,hostId:string) {
  const id=createId(),now=nowIso();
  await this.db.prepare("INSERT INTO routing_forms(id,title,host_id,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(id,input.title,hostId,JSON.stringify(input),now,now).run();
  return {id,...input,hostId,createdAt:now,updatedAt:now};
 }
 async issue(formId:string,hash:string,expiresAt:string) {
  const now=nowIso();
  await this.db.prepare("INSERT INTO routing_capabilities(id,form_id,nonce_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(createId(),formId,hash,expiresAt,now,now).run();
 }
 async capability(formId:string,hash:string) {
  return this.db.prepare("SELECT id,expires_at AS expiresAt,submission_id AS submissionId,payload_hash AS payloadHash FROM routing_capabilities WHERE form_id=? AND nonce_hash=?").bind(formId,hash).first<{id:string;expiresAt:string;submissionId:string|null;payloadHash:string|null}>();
 }
 async result(id:string) {
  const row=await this.db.prepare("SELECT result_json AS result FROM routing_submissions WHERE id=?").bind(id).first<{result:string}>();
  return row ? JSON.parse(row.result) as SubmissionResult : undefined;
 }
 async submit(form:FormRow,capabilityId:string,payloadHash:string,rule:RoutingForm["rules"][number]|undefined,result:SubmissionResult) {
  const now=nowIso();
  // The first insert wins only while this capability is unconsumed. Its exact
  // submission then authorizes consumption in the same atomic D1 batch.
  await this.db.batch([
   this.db.prepare(`INSERT INTO routing_submissions(id,form_id,event_type_id,team_id,host_id,rule_id,state,result_json,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,? FROM routing_capabilities c WHERE c.id=? AND c.form_id=? AND c.consumed_at IS NULL AND c.expires_at>?
    AND (? IS NULL OR EXISTS(SELECT 1 FROM event_types e WHERE e.id=? AND e.status='published'))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM team_event_types m JOIN teams t ON t.id=m.team_id WHERE m.team_id=? AND m.event_type_id=? AND t.host_id=?))`)
    .bind(result.submissionId,form.id,rule?.eventTypeId??null,rule?.teamId??null,form.hostId,rule?.id??null,rule?"matched":"disqualified",JSON.stringify(result),now,now,capabilityId,form.id,now,rule?.eventTypeId??null,rule?.eventTypeId??null,rule?.teamId??null,rule?.teamId??null,rule?.eventTypeId??null,form.hostId),
   this.db.prepare("UPDATE routing_capabilities SET consumed_at=?,submission_id=?,payload_hash=?,updated_at=? WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM routing_submissions WHERE id=?)").bind(now,result.submissionId,payloadHash,now,capabilityId,result.submissionId),
  ]);
  return this.result(result.submissionId);
 }
}
