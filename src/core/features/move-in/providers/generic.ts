import { z } from 'zod';
import type { SavedFile, SourceData } from '../source';
import type { ExternalSource, SourceLoss } from '../external-source';
import { csvRecords } from './csv';
import { calendarBookings, calendarInstant } from './ics';

const metadata=z.object({version:z.literal(1),accountId:z.string().min(1).max(120),name:z.string().min(1),handle:z.string().min(1),timezone:z.string(),capturedAt:z.string().datetime()}).passthrough();
const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const decode=(file:SavedFile)=>new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);
export function readGenericSource(files:SavedFile[]):ExternalSource{
 const source=files.find(f=>f.name==='source.json');if(!source)throw new Error('Choose source.json with the documented CSV templates.');
 const meta=metadata.parse(JSON.parse(decode(source))),base=`https://schedule.invalid/${encodeURIComponent(meta.accountId)}`;
 const data:SourceData={user:[{uri:`${base}/user`,name:meta.name,slug:meta.handle,timezone:meta.timezone}],event_types:[],schedules:[],event_availability:[],scheduled_events:[],invitees:[]},losses:SourceLoss[]=[];
 function loss(resource:SourceLoss['resource'],id:string,field:string){losses.push({resource,sourceId:id,field,reason:'Not carried into Dial. Re-enter this field manually if it is still needed.'});}
 function dropped(value:Record<string,unknown>,kept:string[],resource:SourceLoss['resource'],id:string,prefix=''){
  const visit=(value:unknown,field:string)=>{if(value&&typeof value==='object'&&Object.keys(value).length)for(const [key,child]of Object.entries(value))visit(child,Array.isArray(value)?`${field}[${key}]`:`${field}.${key}`);else loss(resource,id,field);};
  for(const key of Object.keys(value))if(!kept.includes(key))visit(value[key],`${prefix}${key}`);
 }
 dropped(meta,['version','accountId','name','handle','timezone','capturedAt'],'user',data.user[0].uri);
 const rows=(name:string)=>{const file=files.find(f=>f.name===name);if(!file)throw new Error(`Choose ${name} from the documented templates.`);return csvRecords(decode(file));};
 const required=(row:Record<string,string>,key:string)=>{if(!row[key])throw new Error(`Missing ${key} in a template row.`);return row[key];};
 const eventIds=new Set<string>();
 function location(type:string,value:string){if(type==='fixed_link')return {kind:'custom',location:value};if(type==='in_person')return {kind:'physical',location:value};if(type==='phone')return {kind:'inbound_call',phone_number:value};throw new Error('Use fixed_link, in_person or phone for a source location.');}
 for(const row of rows('event-types.csv')){
  const key=required(row,'id'),uri=`${base}/event-types/${encodeURIComponent(key)}`;if(eventIds.has(key))throw new Error('Duplicate event type identifier.');eventIds.add(key);
  if(!['true','false'].includes(row.listed))throw new Error('Event listed must be true or false.');
  data.event_types.push({uri,name:required(row,'title'),slug:required(row,'slug'),duration:Number(required(row,'duration')),description_plain:row.description??'',color:required(row,'color'),active:true,secret:row.listed==='false',kind:'solo',type:'StandardEventType',pooling_type:null,custom_questions:[],locations:[location(required(row,'location_type'),required(row,'location_value'))],duration_options:null});
  dropped(row,['id','title','slug','duration','description','color','listed','location_type','location_value'],'event_types',uri);
 }
 const schedules=new Map<string,SourceData['schedules'][number]>();
 for(const row of rows('availability.csv')){
  const event=required(row,'event_type_id');if(!eventIds.has(event))throw new Error('Availability refers to an unknown event type.');
  const id=`${base}/event-types/${encodeURIComponent(event)}`;let schedule=schedules.get(event);
  if(!schedule){schedule={uri:`${id}/schedule`,user:data.user[0].uri,timezone:meta.timezone,rules:[],default:false,name:'Imported availability'};schedules.set(event,schedule);data.schedules.push(schedule);data.event_availability.push({event_type:id,availability_rule:{uri:schedule.uri}});}
  const intervals=row.start||row.end?[{from:required(row,'start'),to:required(row,'end')}]:[];
  if(row.kind==='weekly'){if(!days.includes(row.day))throw new Error('Use a full lowercase weekday for weekly availability.');schedule.rules.push({type:'wday',wday:row.day,intervals});}
  else if(row.kind==='date'){schedule.rules.push({type:'date',date:required(row,'day'),intervals});}
  else throw new Error('Availability kind must be weekly or date.');
  dropped(row,['event_type_id','kind','day','start','end'],'event_types',id,'availability.');
 }
 function booking(row:Record<string,string>,extra:string[]=[]){
  const key=required(row,'id'),uri=`${base}/bookings/${encodeURIComponent(key)}`,event=required(row,'event_type_id');
  if(!eventIds.has(event))throw new Error('Booking refers to an unknown event type.');
  if(data.scheduled_events.some(b=>b.uri===uri))throw new Error('Duplicate booking identifier.');
  if(!['confirmed','cancelled'].includes(row.status))throw new Error('Booking status must be confirmed or cancelled.');
  const sourceLocation=location(required(row,'location_type'),required(row,'location_value'));
  const active=row.status==='confirmed',created=required(row,'created_at');
  data.scheduled_events.push({uri,event_type:`${base}/event-types/${encodeURIComponent(event)}`,name:required(row,'title'),status:active?'active':'canceled',start_time:required(row,'start'),end_time:required(row,'end'),created_at:created,location:{type:sourceLocation.kind,...sourceLocation},invitees_counter:{active:active?1:0,total:1,limit:1},event_memberships:[{user:data.user[0].uri}],event_guests:[]});
  const answers=(row.answers?z.array(z.object({question:z.string(),answer:z.string(),position:z.number().int()}).passthrough()).parse(JSON.parse(row.answers)):[]).map((answer,index)=>{
   dropped(answer,['question','answer','position'],'scheduled_events',uri,`answers[${index}].`);
   return {question:answer.question,answer:answer.answer,position:answer.position};
  });
  data.invitees.push({uri:`${uri}/invitee`,event:uri,name:required(row,'name'),email:required(row,'email'),timezone:required(row,'timezone'),status:active?'active':'canceled',created_at:created,questions_and_answers:answers});
  dropped(row,['id','event_type_id','title','start','end','created_at','name','email','timezone','location_type','location_value','status','answers',...extra],'scheduled_events',uri);
  return uri;
 }
 const csv=files.find(f=>f.name==='bookings.csv'),ics=files.find(f=>f.name==='bookings.ics');if(Boolean(csv)===Boolean(ics))throw new Error('Choose exactly one of bookings.csv or bookings.ics.');
 if(csv)for(const row of csvRecords(decode(csv)))booking(row);
 if(ics)for(const {fields:f,parameters:p} of calendarBookings(decode(ics))){
  if(!/^mailto:/iu.test(f.ATTENDEE??''))throw new Error('Calendar bookings need one mailto attendee.');
  const uri=booking({id:f.UID,event_type_id:f['X-DIAL-EVENT-TYPE-ID'],title:f.SUMMARY,start:calendarInstant(f.DTSTART),end:calendarInstant(f.DTEND),created_at:calendarInstant(f.CREATED),name:p.ATTENDEE?.CN,email:f.ATTENDEE.slice(7),timezone:f['X-DIAL-INVITEE-TIMEZONE'],location_type:f['X-DIAL-LOCATION-TYPE'],location_value:f.LOCATION,status:f.STATUS==='CONFIRMED'?'confirmed':f.STATUS==='CANCELLED'?'cancelled':'',answers:f['X-DIAL-ANSWERS']??''});
  dropped(f,['UID','X-DIAL-EVENT-TYPE-ID','SUMMARY','DTSTART','DTEND','CREATED','ATTENDEE','X-DIAL-INVITEE-TIMEZONE','X-DIAL-LOCATION-TYPE','LOCATION','STATUS','X-DIAL-ANSWERS'],'scheduled_events',uri);
  for(const [key,parameters]of Object.entries(p))dropped(parameters,key==='ATTENDEE'?['CN']:[],'scheduled_events',uri,`${key}.`);
 }
 const allowed=new Set(['source.json','event-types.csv','availability.csv',csv?'bookings.csv':'bookings.ics']);if(files.some(f=>!allowed.has(f.name)))throw new Error('Select only the four files in the documented template.');
 return {data,losses,capturedAt:meta.capturedAt};
}
