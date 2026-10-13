import manifest from '../../../../seed.json';
import { hostDateSchema } from '../../shared/scheduling';
import type { SourceData } from './source';
import { stableId, safeText, type Accounting, type Choices, type NativeValue, type Row, type Snapshot } from './model';
import { mapLocations } from './map-locations';
const questionKinds={string:'text',text:'textarea',single_select:'single_choice',multi_select:'multiple_choice'} as const;
export function mapEvent(raw:SourceData['event_types'][number],data:SourceData,choices:Choices,snapshot:Snapshot,zone:string,asOf:string){
 const id=stableId(raw.uri),accounting:Accounting[]=[];
 const add=(kind:Accounting['kind'],name:string,outcome:Accounting['outcome'],reason:string)=>accounting.push({kind,sourceId:raw.uri,name,outcome,reason});
 const association=data.event_availability.find(s=>s.event_type===raw.uri)?.availability_rule;
 const schedule=association?.rules?association:data.schedules.find(s=>s.uri===association?.uri);
 function skipSchedule(reason:string){for(const unknownRule of schedule?.rules??[]){const rule=unknownRule as SourceData['schedules'][number]['rules'][number];if(rule.type==='date')add('overrides',rule.date??'Date override','skipped',reason);else for(const interval of rule.intervals??[])add('availability',`${rule.wday??'Window'} ${interval.from}–${interval.to}`,'skipped',reason);}}
 function skipChildren(reason:string){for(const q of raw.custom_questions)add('questions',q.name,'skipped',reason);for(const loc of raw.locations??[])add('locations',loc.kind??'Location','skipped',reason);skipSchedule(reason);}
 if(choices.skipEvents?.includes(raw.uri)||raw.kind!=='solo'||raw.pooling_type||raw.type!=='StandardEventType'||raw.booking_method==='poll'){add('eventTypes',raw.name??raw.uri,'skipped','Owner choice or unsupported group, pooled, poll or ad hoc event.');skipChildren('Parent event is skipped.');return {id,accounting};}
 try{
 const title=safeText(raw.name,120,'Event title'),description=safeText(raw.description_plain??'',4000,'Description');
 if(!Number.isInteger(raw.duration)||raw.duration<5||raw.duration>480)throw new Error('Duration must be 5–480 minutes.');
 if(!/^#[0-9a-f]{6}$/iu.test(raw.color))throw new Error('Colour must be a six-digit hexadecimal colour.');
 if(!raw.slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw.slug)||raw.slug.length>80)throw new Error('Choose a valid event slug in the source before saving again.');
 let slug=raw.slug,n=2;while(snapshot.slugs.includes(slug)&&!snapshot.existing.has(id))slug=`${raw.slug.slice(0,70)}-${n++}`;
 add('eventTypes',title,'changed',`Imported as draft${!raw.active?'; source inactive':''}${slug!==raw.slug?`; slug changed to ${slug}`:''}${(raw.duration_options?.length??0)>1?`; additional durations dropped: ${raw.duration_options!.filter(v=>v!==raw.duration).join(', ')}`:''}.`);
 const {location,accounting:locations,eventReason}=mapLocations(raw.locations??[],choices.locations?.[raw.uri]);
 for(const item of locations)add('locations',item.name,item.outcome,item.reason);
 if(eventReason)accounting[0].reason+=` ${eventReason}`;
 safeText(location.value,1000,'Location');safeText(location.label,120,'Location label');
 if(location.type==='fixed_link'&&!/^https:\/\/[^\s]+$/u.test(location.value))throw new Error('Fixed location must be an HTTPS URL.');
 const tables:Record<string,Row[]>={event_types:[{id,status:'draft',slug,title,description,duration_minutes:raw.duration,color:raw.color,location_type:location.type,location_label:location.label,location_value:location.value,listed:raw.secret?0:1,alternative_requests_enabled:1,slot_increment_minutes:15,minimum_notice_minutes:240,booking_horizon_days:60,before_buffer_minutes:0,after_buffer_minutes:0,host_day_booking_limit:null,request_only:0,created_at:asOf,updated_at:asOf}],event_questions:[],recurring_availability_windows:[],availability_date_overrides:[],availability_date_override_windows:[]};
 for(const name of ['start increment: 15 minutes','minimum notice: 240 minutes','horizon: 60 days','buffer before: 0 minutes','buffer after: 0 minutes','daily limit: unlimited'])add('settings',name,'changed','Set in Dial: not supplied by the documented event-type response.');
 for(const q of [...raw.custom_questions].sort((a,b)=>a.position-b.position)){
 if(!q.enabled||q.type==='phone_number'){add('questions',q.name,'skipped',!q.enabled?'Disabled in source.':'Dial never collects an invitee phone number.');continue;}
 const kind=questionKinds[q.type as keyof typeof questionKinds];if(!kind)throw new Error('Unsupported question type.');
 safeText(q.name,240,'Question');if(q.answer_choices.length>50)throw new Error('Question exceeds 50 options.');
 const options=q.answer_choices.map((label,i)=>({value:`option_${i}`,label:safeText(label,120,'Option')}));
 const qid=stableId(`${raw.uri}:question:${q.position}`);tables.event_questions.push({id:qid,event_type_id:id,public_key:`q_${qid}`,position:tables.event_questions.length,kind,label:q.name,required:q.required?1:0,options_json:JSON.stringify(options),created_at:asOf,updated_at:asOf});
 add('questions',q.name,q.include_other?'changed':'imported',q.include_other?'Free other answer dropped; saved booking answers remain text.':'Order and required state retained.');
 }
 if(tables.event_questions.length>25)throw new Error('Event exceeds 25 enabled questions.');
 if(!schedule){add('availability','Schedule','skipped','No documented schedule association; configure availability in Dial.');}
 else if(choices.skipAvailability?.includes(raw.uri)||schedule.timezone!==zone){skipSchedule(`Source zone ${schedule.timezone}; choose that host zone or skip availability. Wall-clock times are not converted.`);}
 else {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf));
 for(const [index,unknownRule] of (schedule.rules??[]).entries()){
 const rule=unknownRule as SourceData['schedules'][number]['rules'][number];
 const isDate=rule.type==='date',key=rule.date??rule.wday??'';
 if(isDate&&key<today){add('overrides',key,'skipped','Past date override.');continue;}
 const windows=rule.intervals.map(interval=>{const parse=(value:string)=>{if(!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/u.test(value))throw new Error('Invalid availability time.');return Number(value.slice(0,2))*60+Number(value.slice(3));};return {start:parse(interval.from),end:parse(interval.to)};});
 windows.sort((a,b)=>a.start-b.start);if(windows.some((w,i)=>w.start>=w.end||(i>0&&windows[i-1].end>w.start)))throw new Error('Availability windows overlap or have invalid bounds.');
 if(isDate){if(!hostDateSchema.safeParse(key).success)throw new Error('Invalid override date.');if(tables.availability_date_overrides.some(o=>o.host_date===key))throw new Error('Duplicate override date.');const oid=stableId(`${raw.uri}:override:${index}`);tables.availability_date_overrides.push({id:oid,event_type_id:id,host_date:key,mode:windows.length?'open':'closed',created_at:asOf,updated_at:asOf});for(const [i,w]of windows.entries())tables.availability_date_override_windows.push({id:stableId(`${oid}:${i}`),override_id:oid,position:i,start_minute:w.start,end_minute:w.end,created_at:asOf,updated_at:asOf});add('overrides',key,'imported','Wall-clock intervals copied.');}
 else {const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(key);if(weekday<0)throw new Error('Invalid weekday.');for(const [i,w]of windows.entries()){if(tables.recurring_availability_windows.some(row=>row.weekday===weekday&&Number(row.start_minute)<w.end&&Number(row.end_minute)>w.start))throw new Error('Availability windows overlap across weekday rules.');tables.recurring_availability_windows.push({id:stableId(`${raw.uri}:window:${index}:${i}`),event_type_id:id,weekday,start_minute:w.start,end_minute:w.end,created_at:asOf,updated_at:asOf});add('availability',`${key} ${w.start}–${w.end}`,'imported','Wall-clock interval copied.');}}
 }
 }
 if(tables.availability_date_overrides.length>manifest.limits.maxAvailabilityOverridesPerEventType)throw new Error(`Availability exceeds ${manifest.limits.maxAvailabilityOverridesPerEventType} date overrides.`);
 if(tables.recurring_availability_windows.length>1000||tables.availability_date_override_windows.length>1000)throw new Error('Availability exceeds 1000 windows.');
 snapshot.slugs.push(slug);
 return {id,accounting,value:{tables} as NativeValue};
 }catch(error){accounting.length=0;add('eventTypes',raw.name??raw.uri,'rejected',error instanceof Error?error.message:'Invalid event.');skipChildren('Parent event is rejected.');return {id,accounting};}
}
