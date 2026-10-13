import type { SourceDifference } from './differences';
import type { difference } from './report-schema';
import type { z } from 'zod';

export type Difference=z.infer<typeof difference>;
type Live={id:string;name:string;state:string;startAt:string;originalStartAt:string};
const needsDecision=(kind:string)=>kind!=='unchanged';

/** Each difference with the booking as Dial holds it now. A difference is resolved
 * by an operator decision (keep or release), an ordinary Dial cancellation, or an
 * ordinary reschedule to the source time. Erased bookings are not listed. */
export async function describeDifferences(db:D1Database,items:Array<SourceDifference&{decision?:'kept'|'released'|null}>):Promise<Difference[]>{
 if(!items.length)return [];
 const live=new Map((await db.prepare(`SELECT b.id,b.invitee_name AS name,b.state,current.start_at AS startAt,original.start_at AS originalStartAt
  FROM bookings b JOIN booking_occurrences current ON current.id=b.current_occurrence_id
  JOIN booking_occurrences original ON original.booking_id=b.id AND original.sequence=0
  WHERE b.id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(items.map(item=>item.bookingId))).all<Live>()).results.map(row=>[row.id,row]));
 return items.flatMap(item=>{
  const booking=live.get(item.bookingId);if(!booking)return [];
  const decision=item.decision??(booking.state==='cancelled'?'cancelled':item.kind==='moved'&&item.sourceStartAt===booking.startAt?'rescheduled':null);
  return [{bookingId:item.bookingId,name:booking.name,kind:item.kind,startAt:booking.startAt,originalStartAt:booking.originalStartAt,sourceStartAt:item.sourceStartAt,decision,resolved:!needsDecision(item.kind)||decision!==null}];
 });
}

export async function storedDifferences(db:D1Database,jobId:string){
 const rows=(await db.prepare('SELECT booking_id AS bookingId,kind,source_start_at AS sourceStartAt,source_end_at AS sourceEndAt,decision FROM move_in_differences WHERE job_id=? ORDER BY rowid').bind(jobId).all<SourceDifference&{decision:'kept'|'released'|null}>()).results;
 return describeDifferences(db,rows);
}
