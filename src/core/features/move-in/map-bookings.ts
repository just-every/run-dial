import type { SourceData } from './source';
import { stableId, safeText, validZone, hostDate, type NativeValue, type Snapshot, type Accounting } from './model';
export function mapBooking(raw:SourceData['scheduled_events'][number],data:SourceData,events:Map<string,NativeValue>,snapshot:Snapshot,zone:string,asOf:string,tokenHash:string,operatorId:string){
 const id=stableId(raw.uri),invitees=data.invitees.filter(i=>i.event===raw.uri&&i.status==='active'),invitee=invitees[0];
 const accounting:Accounting={kind:'bookings',sourceId:raw.uri,name:invitee?.name??raw.name??'Booking',...(Number.isFinite(Date.parse(raw.start_time))?{startAt:raw.start_time}:{}),outcome:'imported',bookingOutcome:'toImport',reason:'Confirmed; imported silently.'};
 function skip(reason:string,reject=false,bookingOutcome:Accounting['bookingOutcome']='invalid'){return {id,value:undefined,accounting:{...accounting,outcome:reject?'rejected' as const:'skipped' as const,reason,bookingOutcome}};}
 if(raw.status!=='active')return skip('Cancelled in source.',false,'cancelled');
 if(!Number.isFinite(Date.parse(raw.start_time))||!Number.isFinite(Date.parse(raw.end_time)))return skip('Invalid booking instant.',true);
 if(Date.parse(raw.start_time)<=Date.parse(asOf))return skip('Already past at import time.',false,'past');
 if(invitees.length!==1||raw.invitees_counter.active!==1||raw.event_guests.length)return skip('Several invitees or missing invitee.',false,'severalInvitees');
 const event=events.get(raw.event_type)?.tables.event_types[0];if(!event)return skip('On a skipped or rejected event type.',false,'skippedEvent');
 // A catch-up can find an event the owner has since opened for requests only; Dial holds no booking on one.
 if(event.request_only===1)return skip('This event type is open for requests only in Dial, which holds no bookings on it. Make it bookable and catch up again, or create this booking by hand.',true,'skippedEvent');
 try{
 const start=new Date(raw.start_time).toISOString(),end=new Date(raw.end_time).toISOString(),duration=(Date.parse(end)-Date.parse(start))/60000;
 if(!Number.isInteger(duration)||duration<5||duration>480)throw new Error('Booking duration must be 5–480 minutes.');
 safeText(invitee.name,160,'Invitee name');safeText(invitee.email,320,'Invitee email');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(invitee.email))throw new Error('Invalid invitee email.');
 if(!invitee.timezone||!validZone(invitee.timezone))throw new Error('Invitee requires a valid IANA timezone.');
 const member=raw.event_memberships.find(m=>m.user===data.user[0].uri);
 const before=typeof member?.buffered_start_time==='string'?new Date(member.buffered_start_time).toISOString():start;
 const after=typeof member?.buffered_end_time==='string'?new Date(member.buffered_end_time).toISOString():end;
 if(before>start||after<end)throw new Error('Invalid source occupied interval.');
 if(snapshot.busy.some(b=>b.id!==id&&b.start<after&&b.end>before))return skip('Overlapping confirmed Dial or earlier imported booking.',true,'overlapping');
 const loc=raw.location;const location=typeof loc.join_url==='string'?loc.join_url:typeof loc.location==='string'?loc.location:typeof loc.phone_number==='string'?loc.phone_number:'';
 safeText(location,2000,'Booking location');if(location.startsWith('http')&&!/^https:\/\/[^\s]+$/u.test(location))throw new Error('Source join link must use HTTPS.');
 if(!location&&loc.type==='google_conference')throw new Error('Source meeting link is missing; recover it before import.');
 if(!location)throw new Error('Source booking location is missing; recover it before import.');
 const locationType=loc.type==='physical'?'in_person':loc.type==='inbound_call'?'phone':loc.type==='google_conference'?'google_meet':/^https:\/\//u.test(location)?'fixed_link':String(event.location_type);
 const locationLabel=locationType==='in_person'?'In person':locationType==='phone'?'Call the host':locationType==='google_meet'?'Google Meet':'Existing meeting link';
 const occurrence=stableId(`${raw.uri}:occurrence`),created=new Date(raw.created_at).toISOString();
 const tables:NativeValue['tables']={bookings:[{id,event_type_id:event.id,event_slug:event.slug,event_title:safeText(raw.name??event.title,120,'Booking title'),duration_minutes:duration,location_type:locationType,location_label:locationLabel,location_value:location,invitee_name:invitee.name,invitee_email:invitee.email,host_timezone:zone,invitee_timezone:invitee.timezone,state:'confirmed',ical_uid:`dial-${id}@dial`,calendar_state:'succeeded',meeting_state:'not_required',meeting_url:typeof loc.join_url==='string'?loc.join_url:null,current_occurrence_id:occurrence,created_at:created,updated_at:asOf,cancelled_at:null,cancelled_reason:null,calendar_provider_event_id:null,calendar_provider_updated_at:null,imported:1}],booking_occurrences:[{id:occurrence,booking_id:id,sequence:0,start_at:start,end_at:end,occupied_start_at:before,occupied_end_at:after,host_date:hostDate(start,zone),state:'current',is_current:1,replaced_by_occurrence_id:null,created_at:created,closed_at:null}],booking_answers:[],booking_manage_tokens:[{id:stableId(`${raw.uri}:manage`),booking_id:id,token_hash:tokenHash,expires_at:new Date(Date.parse(start)+90*86400000).toISOString(),rotated_at:null,invalidated_at:null,created_at:asOf,updated_at:asOf}],booking_history:[],booking_attendance:[],booking_calendar_conflicts:[]};
 for(const [i,a]of invitee.questions_and_answers.entries()){safeText(a.question,240,'Answer label');safeText(a.answer,4000,'Answer');tables.booking_answers.push({id:stableId(`${raw.uri}:answer:${i}`),booking_id:id,question_key:`imported_${i}`,question_label:a.question,question_kind:'textarea',value_json:JSON.stringify(a.answer),created_at:created});}
 // The reviewed snapshot time is immutable across apply/resume. It is not the
 // server's apply wall-clock time; the original provider creation stays above.
 tables.booking_history.push({id:stableId(`${raw.uri}:created`),booking_id:id,occurrence_id:occurrence,action:'created',actor_type:'operator',actor_id:operatorId,previous_start_at:null,new_start_at:start,reason:'Imported from saved source at the reviewed snapshot as-of time; application wall-clock time is not recorded.',created_at:asOf});
 snapshot.busy.push({id,start:before,end:after});
 return {id,accounting,value:{tables} as NativeValue};
 }catch(error){return skip(error instanceof Error?error.message:'Invalid booking.',true);}
}
