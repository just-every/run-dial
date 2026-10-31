import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useDocumentInstant } from "../../../app/document-data";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { useHydrated } from "../../../app/use-hydrated";
import { FocusDialog } from "../../../app/ui/focus-dialog";
import { PageHeader } from "../../../app/ui/page-header";
import { buttonClassName, Input, Select, PlainLink } from "../../../app/ui/primitives";
import { api, errorMessage } from "../../../api/client";
import { BookingDetail } from "./booking-detail";
import { BookingsFilterBar } from "./bookings-filter-bar";
import { bookingWorkspaceSearch, writeBookingFilters } from "./booking-filters";
import { useBookingWorkspace } from "./use-booking-workspace";
import { useEventTypes } from "./use-event-types";
import { advanceCalendar, calendarRange, civilDate, validCalendarDate, type CalendarMode } from "./calendar-dates";
import { useCalendarBookings } from "./use-calendar-bookings";
import { CalendarGrid } from "./calendar-grid";
export function CalendarWorkspace() {
  const instant=useDocumentInstant(),[now,setNow]=useState(instant),[revision,setRevision]=useState(0),[selected,setSelected]=useState<string>(),[notice,setNotice]=useState('');
  const {filters,navigate}=useBookingWorkspace(),router=useRouter(),search=useRouterState({select:s=>bookingWorkspaceSearch(s.location.search,s.location.searchStr)}),params=new URLSearchParams(search);
  const profile=useWorkspaceRead<{timezone:string;name:string}>('/api/app/profile'),zone=profile?.timezone??'UTC',hydrated=useHydrated();
  const mode:CalendarMode=params.get('calendarMode')==='day'?'day':params.get('calendarMode')==='month'?'month':'week';
  const anchor=validCalendarDate(params.get('calendarDate'))??filters.from??civilDate(instant,zone),range=calendarRange(anchor,mode),activeFilters={...filters,from:range.from,to:range.through};
  const {records,error}=useCalendarBookings(activeFilters,revision),{eventTypes}=useEventTypes();
  useEffect(()=>{const value=new URLSearchParams(search);if(value.get('from')===range.from&&value.get('to')===range.through&&value.get('calendarDate')===anchor&&value.get('calendarMode')===mode)return;value.set('from',range.from);value.set('to',range.through);value.set('calendarDate',anchor);value.set('calendarMode',mode);value.delete('page');void router.navigate({to:'/app/bookings',search:()=>Object.fromEntries(value),replace:true,resetScroll:false});},[search,range.from,range.through,anchor,mode,router]);
  useEffect(()=>{const update=()=>setNow(new Date().toISOString());update();const timer=window.setInterval(update,60000);return()=>window.clearInterval(timer);},[]);
  function move(nextMode:CalendarMode,date:string){const next=calendarRange(date,nextMode),values=new URLSearchParams(writeBookingFilters(search,{...filters,from:next.from,to:next.through}));values.set('view','calendar');values.set('calendarMode',nextMode);values.set('calendarDate',date);void router.navigate({to:'/app/bookings',search:()=>Object.fromEntries(values),resetScroll:false});setSelected(undefined);}
  const refresh=(message?:string)=>{setNotice(message??'');setRevision(value=>value+1);};
  const selectedRecord=records?.find(b=>b.id===selected);
  const listSearch=Object.fromEntries(new URLSearchParams(writeBookingFilters(search,activeFilters)));delete listSearch.view;
  return <div className="grid min-w-0 gap-6" data-calendar-ready={Boolean(records)}><PageHeader title="Booking calendar" description={`Times in ${zone}. Arrow keys move between days; Enter opens the first booking.`} actions={<PlainLink to="/app/bookings" search={()=>listSearch} className={buttonClassName('secondary')}>Filtered list</PlainLink>}/>
    {notice?<p role="status">{notice}</p>:null}{error?<WorkspaceLoadState error={error} onRetry={()=>setRevision(v=>v+1)}/>:null}
    <fieldset disabled={!hydrated} className="flex min-w-0 flex-wrap items-end gap-3"><legend className="sr-only">Calendar navigation</legend><label className="grid gap-2" htmlFor="calendar-mode">Calendar view<Select id="calendar-mode" value={mode} onChange={e=>move(e.target.value as CalendarMode,anchor)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></label><label className="grid gap-2" htmlFor="calendar-anchor">Calendar date<Input id="calendar-anchor" type="date" value={anchor} onChange={e=>{const date=validCalendarDate(e.target.value);if(date)move(mode,date);}}/></label><button type="button" className={buttonClassName('secondary')} onClick={()=>move(mode,advanceCalendar(anchor,mode,-1))}>Previous {mode}</button><button type="button" className={buttonClassName('secondary')} onClick={()=>move(mode,civilDate(now,zone))}>Today</button><button type="button" className={buttonClassName('secondary')} onClick={()=>move(mode,advanceCalendar(anchor,mode,1))}>Next {mode}</button></fieldset>
    <BookingsFilterBar filters={activeFilters} eventTypes={eventTypes} hostTimezone={zone} onChange={change=>{const next={...activeFilters,...change};if(change.from||change.to){move(mode,change.from??change.to!);return;}void navigate(next,1);}} onClear={()=>void navigate({from:range.from,to:range.through},1)}/>
    <p role="status">{records?`${records.length} matching bookings`:null}</p>{!records&&!error?<WorkspaceLoadState label="Loading calendar…" onRetry={()=>setRevision(v=>v+1)}/>:null}
    {records?<CalendarGrid days={range.days} mode={mode} zone={zone} now={now} records={records} onSelect={setSelected}/>:null}
    {selectedRecord?<FocusDialog title="Calendar booking record" onClose={()=>setSelected(undefined)}><section aria-label="Selected calendar booking"><BookingDetail key={selectedRecord.id} booking={selectedRecord} onChanged={async message=>refresh(message)} onCancel={async id=>{const reason=window.prompt('Reason for cancellation (optional)');if(reason===null)return;const response=await api.api.app.bookings[':id'].cancel.$post({param:{id},json:reason?{reason}:{}});refresh(response.ok?'Booking cancelled.':await errorMessage(response));}} onAttendance={async(id,status)=>{const note=window.prompt('Attendance note');if(note===null)return;const response=await api.api.app.bookings[':id'].attendance.$post({param:{id},json:{status,note}});refresh(response.ok?'Attendance recorded.':await errorMessage(response));}} onErased={message=>{setSelected(undefined);refresh(message);}}/></section></FocusDialog>:null}
  </div>;
}
