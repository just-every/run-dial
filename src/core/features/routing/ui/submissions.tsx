import {OverflowRegion} from './overflow-region';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../../../app/ui/primitives';
import {formPath,routingRequest} from './transport';
import {periodFilters,ReportPeriodFields,type ReportPeriod,type ReportFilters} from './report-period';
export type Submission = {id:string;createdAt?:string;ruleId?:string|null;ruleLabel?:string;answers?:{key:string;label:string;kind:string;value:string|string[];private?:boolean}[];bookingId?:string|null};
export type Report = {definition:string;period:ReportPeriod;groups:{ruleId:string|null;ruleLabel:string;source:string;submissions:number;bookings:number;conversion:number;submissionIds:string[];bookingIds:string[]}[]};
type Selection = {ids:string[];bookings:string[];label:string};
const sameFilters=(left:ReportFilters,right:ReportFilters)=>left.fromDate===right.fromDate&&left.throughDate===right.throughDate&&left.eventTypeId===right.eventTypeId;
export function Submissions({id,events,submissions,report}:{id:string;events:{id:string;title:string}[];submissions:Submission[];report?:Report}) {
 const [data,setData]=useState({submissions,report});
 const [filters,setFilters]=useState(()=>periodFilters(report?.period));
 const applied=useRef(periodFilters(report?.period));
 const request=useRef(0);
 const [selection,setSelection]=useState<Selection>();
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  request.current+=1;
  const previous=applied.current,next=periodFilters(report?.period);
  applied.current=next;
  setFilters(current=>sameFilters(current,previous)?next:current);
  setData({submissions,report});setSelection(undefined);setWorking(false);setError('');
 },[id,submissions,report]);
 useEffect(()=>()=>{request.current+=1;},[]);
 async function apply(){
  if(working)return;
  const serial=++request.current;
  const query=new URLSearchParams({fromDate:filters.fromDate,throughDate:filters.throughDate});
  if(filters.eventTypeId)query.set('eventTypeId',filters.eventTypeId);
  setWorking(true);setError('');
  try{
   const result=await routingRequest<{submissions:Submission[];report:Report}>(`${formPath}/${encodeURIComponent(id)}?${query}`);
   if(serial!==request.current)return;
   applied.current=periodFilters(result.report.period);
   setData(result);setSelection(undefined);
  }catch(cause){if(serial===request.current)setError(cause instanceof Error?cause.message:'The report could not be loaded.');}
  finally{if(serial===request.current)setWorking(false);}
 }
 const currentReport=data.report;
 const visible=selection?data.submissions.filter(submission=>selection.ids.includes(submission.id)):data.submissions;
 return <section className="grid min-w-0 gap-4 rounded-xl border border-line p-5 text-[15px]">
  <h3 className="text-lg font-semibold">Submissions and conversion</h3>
  <ReportPeriodFields filters={filters} onChange={setFilters} events={events} working={working} onApply={()=>void apply()}/>
  {error?<div role="alert" className="grid gap-2"><p>{error}</p><Button type="button" variant="quiet" disabled={working} onClick={()=>void apply()}>Retry report</Button></div>:null}
  {working?<p role="status">Loading the selected period…</p>:null}
  {currentReport?<>
   <p className="text-soft">Showing {currentReport.period.fromDate} through {currentReport.period.throughDate}, inclusive, in {currentReport.period.timezone}. {currentReport.period.eventTypeId?`Event: ${events.find(event=>event.id===currentReport.period.eventTypeId)?.title??currentReport.period.eventTypeId}.`:'All event types.'}</p>
   <p className="text-soft">{currentReport.definition}</p>
   <OverflowRegion label="Routing conversion figures"><table className="w-full text-left text-[13px]">
    <thead><tr><th className="p-2">Route</th><th className="p-2">Source</th><th className="p-2">Submissions</th><th className="p-2">Bookings</th><th className="p-2">Conversion</th></tr></thead>
    <tbody>{currentReport.groups.map((group,index)=><tr className="odd:bg-wash" key={index}>
     <td className="p-2"><button type="button" className="underline" onClick={()=>setSelection({ids:group.submissionIds,bookings:group.bookingIds,label:`${group.ruleLabel||'Fallback'} · ${group.source||'Direct'}`})}>{group.ruleLabel||'Fallback'}</button></td>
     <td className="p-2">{group.source||'Direct'}</td><td className="p-2">{group.submissions}</td><td className="p-2">{group.bookings}</td><td className="p-2">{new Intl.NumberFormat('en',{style:'percent',maximumFractionDigits:1}).format(group.conversion)}</td>
    </tr>)}</tbody>
   </table></OverflowRegion>
  </>:null}
  {selection?<div className="grid gap-2"><strong>{selection.label}</strong><Button variant="quiet" type="button" onClick={()=>setSelection(undefined)}>Show all submissions in this period</Button>{selection.bookings.map(bookingId=><a key={bookingId} className="break-all underline" href={`/app/bookings?record=${encodeURIComponent(bookingId)}`}>Booking {bookingId}</a>)}</div>:null}
  {visible.map(submission=><details key={submission.id} className="rounded-xl border border-line p-4">
   <summary className="cursor-pointer break-words">{submission.createdAt?new Date(submission.createdAt).toLocaleString():submission.id} · {submission.ruleLabel||submission.ruleId||'Fallback'}</summary>
   <dl className="mt-3 grid gap-2">{(submission.answers??[]).map(({key,label,value,private:privateAnswer})=><div key={key}><dt className="font-semibold">{label||key}{privateAnswer?' · Private':''}</dt><dd className="break-words">{Array.isArray(value)?value.join(', '):String(value??'')}</dd></div>)}</dl>
   {submission.bookingId?<a className="mt-3 inline-block underline" href={`/app/bookings?record=${encodeURIComponent(submission.bookingId)}`}>Open booking</a>:null}
  </details>)}
  {!visible.length?<p className="text-soft">No submissions in this selection.</p>:null}
 </section>;
}
