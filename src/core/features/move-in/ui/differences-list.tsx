import { Button } from '../../../app/ui/primitives';
import type { Difference } from '../difference-report';
const kinds={unchanged:'Unchanged',moved:'Moved at source',cancelled:'Cancelled at source',invitee_changed:'Invitee changed at source',missing:'No longer in the capture'} as const;
const decisions={kept:'Kept as it is in Dial',released:'Time released without an email',cancelled:'Cancelled in Dial',rescheduled:'Rescheduled in Dial to the source time'} as const;
const keepLabel={moved:'Keep the Dial time',invitee_changed:'Keep the Dial booking',missing:'Keep the Dial booking',cancelled:'Keep the Dial booking',unchanged:''} as const;

/** Differences change nothing by themselves. Decisions are possible once the catch-up is applied. */
export function DifferencesList({differences,zone,applied,busy,onDecide}:{differences:Difference[];zone:string;applied:boolean;busy:boolean;onDecide:(path:string)=>void}){
 if(!differences.length)return null;
 const time=(value:string)=>new Intl.DateTimeFormat('en',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
 const open=differences.filter(item=>!item.resolved).length;
 return <section className="space-y-3" aria-label="Differences from this capture">
  <h3 className="font-semibold">Differences from this capture</h3>
  <p className="text-sm">{open?`${open} of ${differences.length} still-future imported ${differences.length===1?'booking needs':'bookings need'} a decision.`:'Every listed booking is unchanged or decided.'} Nothing changes until you decide.{applied?'':' Apply the catch-up to decide.'}</p>
  <ul className="space-y-3 text-sm">{differences.map(item=><li key={item.bookingId} className="min-w-0 break-words rounded-lg border p-3">
   <strong>{item.name}</strong> · {kinds[item.kind]}
   <p>Dial: {time(item.startAt)}{item.kind==='moved'&&item.sourceStartAt?` · Source: ${time(item.sourceStartAt)}`:''}</p>
   {item.decision?<p>{decisions[item.decision]}</p>:null}
   {applied&&!item.resolved?<div className="mt-2 flex flex-wrap gap-2">
    {item.kind==='cancelled'?<Button type="button" disabled={busy} onClick={()=>onDecide(`/api/app/bookings/${item.bookingId}/release-imported`)}>Release this time</Button>:null}
    <Button type="button" variant="secondary" disabled={busy} onClick={()=>onDecide(`/api/app/move-in/differences/${item.bookingId}/keep`)}>{keepLabel[item.kind]}</Button>
    <a className="inline-flex min-h-11 items-center text-sm font-semibold underline" href={`/app/bookings?query=${encodeURIComponent(item.name)}`}>{item.kind==='cancelled'?'Cancel with an email in Bookings':item.kind==='moved'?'Reschedule in Bookings':'Open in Bookings'}</a>
   </div>:null}
   {applied&&!item.resolved&&item.kind==='cancelled'?<p className="mt-1 text-xs">Release frees the time and records you and the reason in history without emailing the invitee, because Calendly already told them. Cancelling in Bookings sends the invitee one ordinary cancellation email.</p>:null}
  </li>)}</ul>
 </section>;
}
