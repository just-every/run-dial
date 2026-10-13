import { createD1ImportJob, readD1ImportJob, resumeD1Import, undoD1Import, readD1ImportUndoReport, type D1ImportContext, type ImportPlan, canonicalJson, sha256, readD1PersistedImport } from '../../../../modules/import-kit/src/d1/index.ts';
import { guardErasedSources } from '../../../../modules/import-kit/src/d1/erasure-claims.ts';
import { stored } from '../../../../modules/import-kit/src/d1/jobs.ts';
import type { SessionRecord } from '../operators';
import { importTargets } from './targets';
import { planMoveIn, reportFromPlan, captureIdentity } from './planning';
import { readSavedFiles, type SavedFile } from './source';
import { reviewedApplication } from './application';
import { issueUploadIdentity, verifyUploadIdentity } from './upload-identity.mjs';
import { uploadGeneration, fenceUploadGeneration } from './upload-generation';
import { reserveSourceContext } from './source-claims';
import type { Choices, Row, Snapshot } from './model';
import { captureMode } from './catch-up';
import { importedBookings } from './differences';
import { captureFacts, recordFacts, forgetFacts } from './facts';
import { describeDifferences, storedDifferences } from './difference-report';
export function importContext(db:D1Database,session:SessionRecord):D1ImportContext{
 return {destination:'dial',namespace:'saved-schedule',mappingVersion:'1',storage:{database:db,targets:importTargets},batchSize:2,maxBatches:1,reversalPolicy:'preserve-conflicts',
 // D1 permits 1000 queries per paid invocation; kit accounts all SQL; two source entities bound native statement expansion.
 // https://developers.cloudflare.com/d1/platform/limits/
 authorization:{principalId:session.id,predicate:()=>({sql:"EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.status='active' AND s.operator_version=o.version AND s.revoked_at IS NULL AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))",params:[session.sessionId,session.id]})}};
}
export class MoveInService{
 constructor(private readonly db:D1Database,private readonly secret:string){}
 async snapshot():Promise<Snapshot>{
  const profile=await this.db.prepare("SELECT * FROM host_profiles WHERE singleton_key='default'").first<Row>();
  const slugs=(await this.db.prepare('SELECT slug FROM event_types').all<{slug:string}>()).results.map(r=>r.slug);
  const busy=(await this.db.prepare("SELECT b.id,o.occupied_start_at AS start,o.occupied_end_at AS end FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.state IN ('confirmed','rescheduled') AND o.is_current=1").all<{id:string;start:string;end:string}>()).results;
  const existing=new Set((await this.db.prepare('SELECT id FROM move_in_targets').all<{id:string}>()).results.map(r=>r.id));
  const events=new Map((await this.db.prepare('SELECT * FROM event_types').all<Row>()).results.map(row=>[String(row.id),row]));return {profile,slugs,busy,existing,events};
 }
 async preview(files:SavedFile[],choices:Choices,asOf:string,session:SessionRecord,uploadIdentity?:string,applying=false){
  const source=await readSavedFiles(files),context=importContext(this.db,session);
  const previous=(await this.db.prepare("SELECT id FROM ik_jobs WHERE principal_id=? AND destination='dial' ORDER BY rowid DESC").bind(session.id).all<{id:string}>()).results;
  const identity=(artifacts:typeof source.bundle.artifacts)=>canonicalJson(artifacts.map(a=>({name:a.name,sha256:a.sha256,size:a.size})).sort((a,b)=>a.name.localeCompare(b.name)));
  let existing:ImportPlan|undefined;
  for(const row of previous){await readD1ImportJob(row.id,context);const {job,plan}=await stored(row.id,context);if(identity(plan.source.artifacts)!==identity(source.bundle.artifacts)&&captureFacts(plan).capture!==captureIdentity(source.bundle.artifacts))continue;
   if(plan.entries.some(e=>e.erased))throw new Error('This saved source contains erased personal data and cannot be replayed.');
   if(job.state==='undone'||job.state==='rolled_back'){
    const undo=await readD1ImportUndoReport(job.id,context,{limit:1000});
    if(undo.dispositions.some(item=>item.disposition==='retained'))throw new Error(`This import retained edited records or their required parents during undo. Reimport is blocked to preserve them. Open saved import ${job.id} to review retained conflicts; no new source copy was saved.`);
    continue;
   }
   existing=plan;break;
  }
  if(applying&&!uploadIdentity)throw new Error('Review an uploaded source before applying.');
  const generation=await uploadGeneration(context);
  const binding={owner:session.id,session:session.sessionId,source:sha256(identity(source.bundle.artifacts)),asOf,generation,bookingCount:source.data.scheduled_events.length};
  const upload=uploadIdentity?await verifyUploadIdentity(uploadIdentity,this.secret,binding):await issueUploadIdentity(this.secret,{...binding,asOf:existing?reportFromPlan(existing).asOf:asOf});
  if(existing){const report=reportFromPlan(existing,'already here');report.items=report.items.map(item=>({...item,reason:`Already here. ${item.reason}`}));return {plan:existing,report,uploadIdentity:upload.identity,generation};}
  const mode=await captureMode(this.db,source.data);
  const catchUp=mode.mode==='catch-up'?{known:mode.known,imported:await importedBookings(this.db)}:undefined;
  const {plan}=await planMoveIn(files,choices,asOf,await this.snapshot(),context,this.secret,upload.nonces,catchUp);
  await guardErasedSources(plan,this.db);await reserveSourceContext(plan,context);
  return {plan,report:reportFromPlan(plan,'preview',await describeDifferences(this.db,captureFacts(plan).differences)),uploadIdentity:upload.identity,generation};
 }
 async apply(files:SavedFile[],choices:Choices,asOf:string,fingerprint:string,acknowledged:boolean,session:SessionRecord,uploadIdentity?:string){
  if(!acknowledged)throw new Error('Acknowledge losses, rejected overlaps and changed values before applying.');
  const {plan,generation}=await this.preview(files,choices,asOf,session,uploadIdentity,true);if(plan.fingerprint!==fingerprint)throw new Error('The source or destination changed. Review a fresh preview.');
  const context=fenceUploadGeneration(await reserveSourceContext(plan,await reviewedApplication(importContext(this.db,session),fingerprint)),generation);
  const job=await createD1ImportJob(plan,context);await recordFacts(this.db,job.id,captureFacts(plan));return this.read(job.id,session);
 }
 async read(id:string,session:SessionRecord){const context=importContext(this.db,session);const job=await readD1ImportJob(id,context);const {plan}=await stored(id,context);return {job,report:reportFromPlan(plan,job.state,await storedDifferences(this.db,id)),...(job.state==='undone'?{undo:await readD1ImportUndoReport(job.id,context,{limit:1000})}:{})};}
 async resume(id:string,session:SessionRecord){await resumeD1Import(id,importContext(this.db,session));const result=await this.read(id,session);
  // An undo can finish over several resumes; its capture facts leave with it.
  if(result.job.state==='undone')await forgetFacts(this.db,id);
  if(result.job.state==='completed'){
  const context=importContext(this.db,session),{plan}=await stored(id,context),persisted=await readD1PersistedImport(context);
  for(const entry of plan.entries)for(const effect of entry.effects){const actual=persisted.rows.filter(row=>row.targetKind===effect.targetKind&&row.targetId===effect.targetId);if(actual.length!==1||canonicalJson(actual[0].value)!==canonicalJson(effect.value))throw new Error('Import reconciliation failed: native data differs from reviewed data.');}
  // New event types exist only now, so their old scheduling links are recorded at completion.
  await recordFacts(this.db,id,captureFacts(plan));
 }return this.read(id,session);}
 async undo(id:string,session:SessionRecord){const job=await undoD1Import(id,importContext(this.db,session));if(job.state==='undone')await forgetFacts(this.db,id);return {...await this.read(id,session),undo:await readD1ImportUndoReport(job.id,importContext(this.db,session),{limit:1000})};}
 async list(session:SessionRecord){return (await this.db.prepare("SELECT j.id,j.state,j.checkpoint,j.total,COALESCE(c.mode,'first') AS mode FROM ik_jobs j LEFT JOIN move_in_captures c ON c.job_id=j.id WHERE j.principal_id=? AND j.destination='dial' ORDER BY j.rowid DESC LIMIT 30").bind(session.id).all()).results;}
 /** Imports applied before this version recorded no native capture facts; derive them once from the operator's own retained plans. */
 async backfill(session:SessionRecord){
  const context=importContext(this.db,session);
  const pending=(await this.db.prepare("SELECT id FROM ik_jobs j WHERE principal_id=? AND destination='dial' AND state='completed' AND NOT EXISTS(SELECT 1 FROM move_in_captures c WHERE c.job_id=j.id) ORDER BY rowid").bind(session.id).all<{id:string}>()).results;
  for(const {id} of pending){await readD1ImportJob(id,context);const {plan}=await stored(id,context);await recordFacts(this.db,id,captureFacts(plan),false);}
 }
 /** The operator keeps the Dial booking as it is: records the decision and changes nothing else. */
 async keep(bookingId:string){
  const result=await this.db.prepare("UPDATE move_in_differences SET decision='kept',decided_at=? WHERE booking_id=? AND kind<>'unchanged' AND decision IS NULL").bind(new Date().toISOString(),bookingId).run();
  return result.meta.changes>0;
 }
 /** Release applies only to an undecided "cancelled at source" difference of a booking still holding time. */
 async releasable(bookingId:string){
  return Boolean(await this.db.prepare("SELECT 1 FROM move_in_differences d JOIN bookings b ON b.id=d.booking_id WHERE d.booking_id=? AND d.kind='cancelled' AND d.decision IS NULL AND b.imported=1 AND b.state IN ('confirmed','rescheduled')").bind(bookingId).first());
 }
 async released(bookingId:string){await this.db.prepare("UPDATE move_in_differences SET decision='released',decided_at=? WHERE booking_id=? AND kind='cancelled' AND decision IS NULL").bind(new Date().toISOString(),bookingId).run();}
}
