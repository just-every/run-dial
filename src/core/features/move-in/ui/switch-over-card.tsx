import { workspaceFetch } from "../../../app/workspace-reads";
import { useEffect, useState } from 'react';
import { Badge, Card, buttonClassName } from '../../../app/ui/primitives';
import type { SwitchOverService } from '../switch-over';
type State=Awaited<ReturnType<SwitchOverService['read']>>;
export const moveInChanged='dial:move-in-changed';
const rowNames={eventTypes:'imported event types are not all published',bookings:'imported bookings are still ahead',differences:'catch-up differences are unresolved',providers:'Google Calendar or the sending address needs attention'} as const;
const day=(value:string)=>new Intl.DateTimeFormat('en',{timeZone:'UTC',dateStyle:'full'}).format(new Date(`${value}T12:00:00Z`));
const instant=(value:string,zone:string)=>new Intl.DateTimeFormat('en',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function Row({title,clear,children}:{title:string;clear:boolean;children:React.ReactNode}){
 return <section className="min-w-0 space-y-2 rounded-lg border p-4"><h3 className="flex flex-wrap items-center gap-2 font-semibold">{title}<Badge tone={clear?'success':'warning'}>{clear?'Clear':'Open'}</Badge></h3>{children}</section>;
}

/** The switch-over checklist: what Dial holds now and what still belongs to the source. */
export function SwitchOverCard({className=''}:{className?:string}){
 const [state,setState]=useState<State>(),[error,setError]=useState('');
 useEffect(()=>{
  const load=()=>void workspaceFetch('/api/app/move-in/switch-over').then(async r=>{if(!r.ok)throw new Error();setState(await r.json() as State);setError('');}).catch(()=>setError('The switch-over checklist could not be loaded.'));
  load();window.addEventListener(moveInChanged,load);return ()=>window.removeEventListener(moveInChanged,load);
 },[]);
 if(error)return <Card id="switch-over" className={`p-5 sm:p-6 ${className}`}><p role="alert" className="text-red-800">{error}</p></Card>;
 if(!state?.imported)return null;
 const zone=state.hostZone;
 return <Card id="switch-over" className={`min-w-0 space-y-4 p-5 sm:p-6 ${className}`}>
  <div><h2 className="text-xl font-bold">Switch over</h2>
   <p className="mt-2 text-sm">Read from what Dial holds now. Dial never changes or contacts your Calendly account; closing it is your step, and the last one.</p>
   <p role="status" className="mt-2 break-words text-sm font-semibold">{state.open.length?`Still open: ${state.open.map(row=>rowNames[row]).join('; ')}.`:'Every row is clear.'}</p>
  </div>
  <Row title="Links to update" clear={!state.open.includes('eventTypes')}>
   <ul className="space-y-3 text-sm">{state.eventTypes.map(event=><li key={event.id} className="min-w-0 break-words"><strong>{event.title}</strong> · {event.status==='published'?'Published':event.status==='draft'?'Draft, ready to publish':'Draft, blocked'}
    <p>Old link: {event.oldLink?<a className="underline" href={event.oldLink}>{event.oldLink}</a>:'not in the capture'}</p>
    <p>Dial link: {event.dialLink?<a className="underline" href={event.dialLink}>{event.dialLink}</a>:'save a host profile first'}{event.status==='published'?'':' (live once published)'}</p>
    {event.reasons.length?<ul className="mt-1 list-disc pl-5">{event.reasons.map(reason=><li key={reason.code}><a className="underline" href={reason.href}>{reason.label}</a></li>)}</ul>:null}
   </li>)}</ul>
   <a className={buttonClassName('secondary')} href="/api/app/move-in/switch-over/links.csv" download>Download the link list</a>
  </Row>
  <Row title="When Calendly can be closed" clear={!state.open.includes('bookings')}>
   <p className="text-sm">{state.bookings.closableOn?`${state.bookings.future} imported ${state.bookings.future===1?'booking is':'bookings are'} still ahead. Their confirmation, manage link and reminders still belong to Calendly, so the earliest day you can close Calendly without stranding an invitee is ${day(state.bookings.closableOn)}.`:'Every imported booking has ended or been cancelled, so no invitee still depends on a Calendly confirmation, manage link or reminder.'}</p>
  </Row>
  <Row title="Differences from the latest catch-up" clear={!state.open.includes('differences')}>
   <p className="text-sm">{state.differences.latestCatchUp?`${state.differences.unresolved} of ${state.differences.total} listed ${state.differences.total===1?'difference needs':'differences need'} a decision.`:'No catch-up has been applied yet.'} Decide them under Move in.</p>
  </Row>
  <Row title="Who sends invitations and reminders for new bookings" clear={!state.open.includes('providers')}>
   <ul className="space-y-1 text-sm">
    <li>Google destination calendar: {state.providers.calendar?<a className="underline" href={state.providers.calendar.href}>{state.providers.calendar.label}</a>:'connected and healthy'}</li>
    <li>Sending address: {state.providers.mail?<a className="underline" href={state.providers.mail.href}>{state.providers.mail.label}</a>:'connected and healthy'}</li>
   </ul>
  </Row>
  <section className="space-y-1 rounded-lg bg-[#f1f6f2] p-4 text-sm"><h3 className="font-semibold">Last capture</h3>
   {state.lastCapture?<p>{state.lastCapture.capturedAt?`Captured ${instant(state.lastCapture.capturedAt,zone)}, ${state.lastCapture.ageDays} ${state.lastCapture.ageDays===1?'day':'days'} ago.`:`Reviewed ${instant(state.lastCapture.asOf,zone)}; this import predates recorded capture times.`} Bookings made at Calendly after it are not here yet: capture again and catch up before you switch.</p>:<p>No capture has been applied yet.</p>}
  </section>
 </Card>;
}
