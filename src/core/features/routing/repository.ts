import { createId, nowIso } from "../../shared/ids";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import type { BookingAttribution } from "../bookings/link-context";
import type { RoutingFormInput, RoutingAnswers } from "./types";
import type { matchRoute } from "./rules";

export type RoutingForm = RoutingFormInput & { id:string; revision:number };
export type RoutingAnswer = { key:string; label:string; kind:string; value:string|string[]; private?:boolean };
export class RoutingRepository {
 constructor(readonly db:D1Database, private readonly secret:string) {}
 async list() { return (await this.db.prepare("SELECT id,revision,configuration_json FROM routing_forms ORDER BY created_at").all<{id:string;revision:number;configuration_json:string}>()).results.map(row=>({...JSON.parse(row.configuration_json) as RoutingFormInput,id:row.id,revision:row.revision})); }
 async get(id:string) { return (await this.list()).find(form=>form.id===id); }
 async publicForm(slug:string) { const row=await this.db.prepare("SELECT id FROM routing_forms WHERE slug=? AND published=1").bind(slug).first<{id:string}>();return row?this.get(row.id):undefined; }
 async save(input:RoutingFormInput,id=createId()) {
  const now=nowIso();
  await this.db.prepare("INSERT INTO routing_forms(id,slug,title,configuration_json,published,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,configuration_json=excluded.configuration_json,published=excluded.published,revision=revision+1,updated_at=excluded.updated_at").bind(id,input.slug,input.title,JSON.stringify(input),input.published?1:0,now,now).run();
  return this.get(id);
 }
 async issue(formId:string) {
  const token=createOpaqueToken(),expiresAt=new Date(Date.now()+30*60_000).toISOString(),now=nowIso();
  await this.db.batch([
   this.db.prepare("DELETE FROM routing_submission_tokens WHERE expires_at<? AND consumed_at IS NULL").bind(now),
   this.db.prepare("INSERT INTO routing_submission_tokens(id,form_id,token_hash,expires_at,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM routing_forms WHERE id=? AND published=1)").bind(createId(),formId,await hashToken(token,this.secret),expiresAt,now,formId),
  ]);
  return {token,expiresAt};
 }
 async token(formId:string,token:string) { return this.db.prepare("SELECT id FROM routing_submission_tokens WHERE token_hash=? AND form_id=? AND consumed_at IS NULL AND expires_at>?").bind(await hashToken(token,this.secret),formId,nowIso()).first<{id:string}>(); }
 async submit(form:RoutingForm,capabilityId:string,answers:RoutingAnswers,attribution:BookingAttribution,route:ReturnType<typeof matchRoute>) {
  const id=createId(),now=nowIso(),handoff=createOpaqueToken(),handoffHash=await hashToken(handoff,this.secret);
  const stored:RoutingAnswer[]=form.questions.filter(q=>answers[q.key]!==undefined).map(q=>({key:q.key,label:q.label,kind:q.kind,value:answers[q.key],private:q.private??false}));
  const email=stored.find(q=>q.kind==="email" && typeof q.value==="string")?.value;
  const emailValue=typeof email==="string"?email.trim().toLowerCase():null;
  const result=await this.db.batch([
   this.db.prepare(`INSERT INTO routing_submissions(id,form_id,capability_id,form_title,rule_id,rule_label,answers_json,attribution_json,invitee_email,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM routing_submission_tokens t JOIN routing_forms f ON f.id=t.form_id WHERE t.id=? AND t.form_id=? AND t.consumed_at IS NULL AND t.expires_at>? AND f.published=1 AND f.revision=?)
    AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=? OR email IN(SELECT lower(trim(atom)) FROM json_tree(?) WHERE type='text'))`).bind(id,form.id,capabilityId,form.title,route.ruleId,route.ruleLabel,JSON.stringify(stored),JSON.stringify(attribution),emailValue,now,now,capabilityId,form.id,now,form.revision,emailValue,JSON.stringify(stored)),
   this.db.prepare("UPDATE routing_submission_tokens SET consumed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM routing_submissions WHERE id=?)").bind(now,capabilityId,id),
   ...(route.outcome.kind==="event"?[this.db.prepare("INSERT INTO routing_handoffs(submission_id,token_hash,event_type_id,expires_at,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM routing_submissions WHERE id=?)").bind(id,handoffHash,route.outcome.eventTypeId,new Date(Date.now()+30*60_000).toISOString(),now,id)]:[]),
  ]);
  return result[0].meta.changes===1?{id,handoff}:undefined;
 }
 async submissions(formId:string) {
  return (await this.db.prepare("SELECT id,rule_id AS ruleId,rule_label AS ruleLabel,answers_json,attribution_json,booking_id AS bookingId,created_at AS createdAt FROM routing_submissions WHERE form_id=? ORDER BY created_at DESC").bind(formId).all<{id:string;ruleId:string|null;ruleLabel:string;answers_json:string;attribution_json:string;bookingId:string|null;createdAt:string}>()).results.map(({answers_json,attribution_json,...row})=>({...row,answers:JSON.parse(answers_json) as RoutingAnswer[],attribution:JSON.parse(attribution_json) as BookingAttribution}));
 }
 async handoff(token:string,eventId:string) {
  const tokenHash=await hashToken(token,this.secret);
  const row=await this.db.prepare(`SELECT s.id,s.answers_json,s.attribution_json,s.rule_id,s.form_id FROM routing_handoffs h JOIN routing_submissions s ON s.id=h.submission_id JOIN routing_forms f ON f.id=s.form_id
   WHERE h.token_hash=? AND h.event_type_id=? AND h.expires_at>? AND s.booking_id IS NULL AND h.booking_claim_id IS NULL AND f.published=1
   AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=s.invitee_email OR email IN(SELECT lower(trim(atom)) FROM json_tree(s.answers_json) WHERE type='text'))`).bind(tokenHash,eventId,nowIso()).first<{id:string;answers_json:string;attribution_json:string;rule_id:string|null;form_id:string}>();
  if(!row)return undefined;
  const form=await this.get(row.form_id);if(!form)return undefined;
  const outcome=row.rule_id?form.rules.find(rule=>rule.id===row.rule_id)?.outcome:form.fallback;
  if(outcome?.kind!=="event"||outcome.eventTypeId!==eventId)return undefined;
  return {submissionId:row.id,tokenHash,answers:JSON.parse(row.answers_json) as RoutingAnswer[],attribution:JSON.parse(row.attribution_json) as BookingAttribution,redirect:outcome.redirect};
 }
}
