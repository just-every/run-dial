import { useRef } from "react";
import type { BookingRecord } from "../types";
import { buttonClassName } from "../../../app/ui/primitives";
import { civilDate, civilLabel, type CalendarMode } from "./calendar-dates";
export function CalendarGrid({days,mode,zone,now,records,onSelect}:{days:string[];mode:CalendarMode;zone:string;now:string;records:BookingRecord[];onSelect:(id:string)=>void}) {
  const headers=useRef<Array<HTMLButtonElement|null>>([]), today=civilDate(now,zone);
  const time=(instant:string)=>new Intl.DateTimeFormat('en',{timeZone:zone,timeStyle:'short'}).format(new Date(instant));
  return <div className={`grid min-w-0 gap-3 ${mode==='day'?'':'md:grid-cols-7'}`} aria-label={`${mode} calendar`} data-calendar-mode={mode}>
    {days.map((day,index)=>{const entries=records.filter(b=>civilDate(b.occurrence.startAt,zone)===day).sort((a,b)=>a.occurrence.startAt.localeCompare(b.occurrence.startAt)||a.id.localeCompare(b.id));const nowIndex=entries.findIndex(b=>b.occurrence.startAt>=now);const marker=<p className="border-t-2 border-gold pt-2 text-sm font-bold" role="status">Now {time(now)}</p>;
      return <section key={day} data-calendar-date={day} className="grid min-w-0 content-start gap-3 rounded-xl border border-line-soft bg-card p-3" aria-label={civilLabel(day)}>
        <button type="button" ref={node=>{headers.current[index]=node;}} className="rounded text-left text-sm font-bold focus-visible:outline-2" onClick={()=>{if(entries[0])onSelect(entries[0].id);}} onKeyDown={event=>{const step=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];if(step){event.preventDefault();headers.current[Math.max(0,Math.min(days.length-1,index+step))]?.focus();}}}>{civilLabel(day)}</button>
        {entries.map((booking,i)=><div key={booking.id} className="grid min-w-0 gap-3">{day===today&&i===nowIndex?marker:null}<button type="button" data-calendar-booking={booking.id} className={buttonClassName('secondary','h-auto min-w-0 justify-start whitespace-normal break-words px-3 py-2 text-left')} onClick={()=>onSelect(booking.id)}><span className="min-w-0"><strong className="block">{time(booking.occurrence.startAt)} · {booking.inviteeName}</strong><span className="block text-xs">{booking.eventTitle} · {booking.state}{booking.imported?' · Imported':''}</span></span></button></div>)}
        {day===today&&nowIndex<0?marker:null}{!entries.length?<p className="text-sm text-muted">No bookings</p>:null}
      </section>;
    })}
  </div>;
}
