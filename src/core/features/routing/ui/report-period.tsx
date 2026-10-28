import {Button,Input,Select} from '../../../app/ui/primitives';
export type ReportPeriod = {fromDate:string;throughDate:string;timezone:string;eventTypeId:string|null};
export type ReportFilters = {fromDate:string;throughDate:string;eventTypeId:string};
export function periodFilters(period?:ReportPeriod):ReportFilters {
 return {fromDate:period?.fromDate??'',throughDate:period?.throughDate??'',eventTypeId:period?.eventTypeId??''};
}
export function ReportPeriodFields({filters,onChange,events,working,onApply}:{filters:ReportFilters;onChange:(filters:ReportFilters)=>void;events:{id:string;title:string}[];working:boolean;onApply:()=>void}) {
 return <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();onApply();}}>
  <label className="grid gap-2">From date<Input required type="date" value={filters.fromDate} max={filters.throughDate||undefined} onChange={event=>onChange({...filters,fromDate:event.target.value})}/></label>
  <label className="grid gap-2">Through date<Input required type="date" value={filters.throughDate} min={filters.fromDate||undefined} onChange={event=>onChange({...filters,throughDate:event.target.value})}/></label>
  <label className="grid gap-2">Event type<Select value={filters.eventTypeId} onChange={event=>onChange({...filters,eventTypeId:event.target.value})}><option value="">All event types</option>{events.map(event=><option key={event.id} value={event.id}>{event.title}</option>)}</Select></label>
  <div className="flex items-end"><Button type="submit" variant="secondary" disabled={working}>{working?'Loading report…':'Apply filters'}</Button></div>
 </form>;
}
