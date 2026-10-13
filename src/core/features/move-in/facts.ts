import type { ImportPlan } from '../../../../modules/import-kit/src/d1/index.ts';
import { stableId } from './model';
import type { SourceDifference } from './differences';

/** What a capture's plan records natively once applied: the capture itself, old
 * scheduling links and the differences list. Native rows travel in whole-install
 * archives and survive reload; the private plan that produced them does not. */
export type CaptureFacts={mode:'first'|'catch-up';capture:string|null;handle:string;capturedAt:string|null;asOf:string;links:Array<{eventTypeId:string;url:string}>;differences:SourceDifference[]};

export function captureFacts(plan:ImportPlan):CaptureFacts{
 const metadata=(plan.entries.find(e=>e.source.kind==='metadata')?.source.payload as {raw?:Partial<CaptureFacts>&{asOf?:string;sourceUser?:{slug?:string}}}|undefined)?.raw??{};
 const user=(plan.entries.find(e=>e.source.kind==='profile')?.source.payload as {raw?:{slug?:string}}|undefined)?.raw??metadata.sourceUser;
 // Plans applied before catch-up existed carry no links; their event pages still name them.
 const links=metadata.links??plan.entries.filter(e=>e.source.kind==='event'&&e.effects.length&&!e.erased).flatMap(e=>{const url=schedulingUrl((e.source.payload as {raw?:{event?:unknown}}).raw?.event);return url?[{eventTypeId:stableId(e.source.sourceId),url}]:[];});
 return {mode:metadata.mode??'first',capture:metadata.capture??null,handle:user?.slug??'',capturedAt:metadata.capturedAt??null,asOf:metadata.asOf??'',links,differences:metadata.differences??[]};
}
export function schedulingUrl(event:unknown){const url=(event as {scheduling_url?:unknown}|undefined)?.scheduling_url;return typeof url==='string'&&/^https:\/\/[^\s]+$/u.test(url)&&url.length<=512?url:null;}

/** Idempotent: apply and every resume may record again. `refresh` lets a newer
 * capture replace an older link; a backfilled older import never overwrites one. */
export async function recordFacts(db:D1Database,jobId:string,facts:CaptureFacts,refresh=true){
 const now=new Date().toISOString();
 const link=refresh?'ON CONFLICT(event_type_id) DO UPDATE SET source_url=excluded.source_url,job_id=excluded.job_id,updated_at=excluded.updated_at WHERE move_in_source_links.source_url IS NOT excluded.source_url':'ON CONFLICT(event_type_id) DO NOTHING';
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO move_in_captures(job_id,mode,source_handle,captured_at,as_of,recorded_at) VALUES(?,?,?,?,?,?)').bind(jobId,facts.mode==='catch-up'?'catch_up':'first',facts.handle,facts.capturedAt,facts.asOf,now),
  ...facts.links.map(item=>db.prepare(`INSERT INTO move_in_source_links(event_type_id,source_url,job_id,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM event_types WHERE id=?) ${link}`).bind(item.eventTypeId,item.url,jobId,now,item.eventTypeId)),
  // An erased booking has left; its difference is never recreated from the plan.
  ...facts.differences.map(item=>db.prepare('INSERT OR IGNORE INTO move_in_differences(job_id,booking_id,kind,source_start_at,source_end_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?)').bind(jobId,item.bookingId,item.kind,item.sourceStartAt,item.sourceEndAt,item.bookingId)),
 ]);
}

/** An undone capture leaves no differences or capture record behind; links stay while their event type does. */
export async function forgetFacts(db:D1Database,jobId:string){
 await db.batch([
  db.prepare('DELETE FROM move_in_differences WHERE job_id=?').bind(jobId),
  db.prepare('DELETE FROM move_in_captures WHERE job_id=?').bind(jobId),
  db.prepare('DELETE FROM move_in_source_links WHERE job_id=? AND NOT EXISTS(SELECT 1 FROM event_types WHERE id=move_in_source_links.event_type_id)').bind(jobId),
 ]);
}
