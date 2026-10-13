import type { NativeValue } from '../model';
function tables(value:unknown){return (value as NativeValue|null)?.tables;}
export function eventName(value:unknown){return String(tables(value)?.event_types?.[0]?.title??'Skipped or rejected event');}
export function EventReview({value}:{value:unknown}){
 const data=tables(value),event=data?.event_types?.[0];
 if(!data||!event)return <p className="text-sm">This event creates no Dial records. Its reason is listed in the report.</p>;
 const fields={Title:event.title,Slug:event.slug,Description:event.description,Duration:`${event.duration_minutes} minutes`,Colour:event.color,Status:event.status,Visibility:event.listed?'Listed':'Unlisted',Location:event.location_label,'Private location':event.location_value||(event.location_type==='google_meet'?'Created for new bookings':'Choose before publishing'),'Start increment':`${event.slot_increment_minutes} minutes`,'Minimum notice':`${event.minimum_notice_minutes} minutes`,Horizon:`${event.booking_horizon_days} days`,'Buffer before':`${event.before_buffer_minutes} minutes`,'Buffer after':`${event.after_buffer_minutes} minutes`,'Daily limit':event.host_day_booking_limit??'Unlimited'};
 return <div className="space-y-3 text-sm"><dl className="space-y-2">{Object.entries(fields).map(([name,item])=><div key={name}><dt className="font-semibold">{name}</dt><dd className="break-words">{String(item)}</dd></div>)}</dl>
  <div><strong>Questions</strong><ol className="list-inside list-decimal">{data.event_questions.map(q=><li key={String(q.id)}>{q.label} · {q.kind} · {q.required?'Required':'Optional'}</li>)}</ol></div>
  <div><strong>Weekly availability</strong><ul>{data.recurring_availability_windows.map(w=><li key={String(w.id)}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(w.weekday)]} {time(Number(w.start_minute))}–{time(Number(w.end_minute))}</li>)}</ul></div>
  <div><strong>Date overrides</strong><ul>{data.availability_date_overrides.map(o=><li key={String(o.id)}>{o.host_date} · {o.mode}{data.availability_date_override_windows.filter(w=>w.override_id===o.id).map(w=>` ${time(Number(w.start_minute))}–${time(Number(w.end_minute))}`).join(', ')}</li>)}</ul></div>
 </div>;
}
function time(minute:number){return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;}
