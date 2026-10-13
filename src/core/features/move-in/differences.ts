import type { SourceData } from './source';
import { stableId } from './model';
import type { differenceKinds } from './report-schema';

export type DifferenceKind=typeof differenceKinds[number];
/** An imported booking as Dial holds it now, with the times it was imported at. */
export type ImportedBooking={id:string;state:string;startAt:string;originalStartAt:string;originalEndAt:string;inviteeEmail:string};
/** Opaque Dial booking ids and source instants only: no personal data in the plan. */
export type SourceDifference={bookingId:string;kind:DifferenceKind;sourceStartAt:string|null;sourceEndAt:string|null};

export async function importedBookings(db:D1Database):Promise<ImportedBooking[]>{
 return (await db.prepare(`SELECT b.id,b.state,b.invitee_email AS inviteeEmail,current.start_at AS startAt,original.start_at AS originalStartAt,original.end_at AS originalEndAt
  FROM move_in_targets t JOIN bookings b ON b.id=t.id
  JOIN booking_occurrences current ON current.id=b.current_occurrence_id
  JOIN booking_occurrences original ON original.booking_id=b.id AND original.sequence=0
  WHERE t.kind='booking' ORDER BY current.start_at,b.id`).all<ImportedBooking>()).results;
}

const iso=(value:string)=>new Date(value).toISOString();
const field=(row:object,key:string)=>(row as Record<string,unknown>)[key];

/** Compare every still-future imported booking with a newer capture. Nothing is
 * changed here; a source reschedule (the old event cancelled with a rescheduled
 * invitee pointing at a new event) is one move, not a new booking. */
export function sourceDifferences(data:SourceData,imported:ImportedBooking[],asOf:string){
 const byId=new Map(data.scheduled_events.map(event=>[stableId(event.uri),event]));
 const eventsByUri=new Map(data.scheduled_events.map(event=>[event.uri,event]));
 const inviteesByUri=new Map(data.invitees.map(invitee=>[invitee.uri,invitee]));
 const rescheduleTargets=new Set<string>(),differences:SourceDifference[]=[];
 for(const booking of imported){
  if(!['confirmed','rescheduled'].includes(booking.state)||Date.parse(booking.startAt)<=Date.parse(asOf))continue;
  const add=(kind:DifferenceKind,start:string|null=null,end:string|null=null)=>differences.push({bookingId:booking.id,kind,sourceStartAt:start&&iso(start),sourceEndAt:end&&iso(end)});
  const raw=byId.get(booking.id);
  if(!raw){add('missing');continue;}
  const invitees=data.invitees.filter(invitee=>invitee.event===raw.uri),active=invitees.filter(invitee=>invitee.status==='active');
  if(raw.status!=='active'||!active.length){
   const next=invitees.map(invitee=>field(invitee,'rescheduled')===true&&typeof field(invitee,'new_invitee')==='string'?inviteesByUri.get(field(invitee,'new_invitee') as string):undefined).find(Boolean);
   const target=next&&eventsByUri.get(next.event);
   if(target&&target.status==='active'){rescheduleTargets.add(target.uri);add('moved',target.start_time,target.end_time);}
   else add('cancelled');
   continue;
  }
  if(iso(raw.start_time)!==iso(booking.originalStartAt)||iso(raw.end_time)!==iso(booking.originalEndAt)){add('moved',raw.start_time,raw.end_time);continue;}
  add(active.length!==1||active[0].email.trim().toLowerCase()!==booking.inviteeEmail.trim().toLowerCase()?'invitee_changed':'unchanged');
 }
 return {differences,rescheduleTargets};
}
