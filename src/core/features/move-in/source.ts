import { consumeBytes } from '../../../../modules/import-kit/src/readers/bytes.ts';
import { safeValue } from '../../../../modules/import-kit/src/readers/records.ts';
import type { SourceBundle } from '../../../../modules/import-kit/src/types.ts';
import { readCalendlyFiles, importLimits, sourceSchemas, type SavedFile, type Resource } from './calendly-source';
import type { SourceLoss } from './external-source';
import { readGenericSource } from './providers/generic';
import { readApiCapture } from './providers/api-capture';
import { csvRecords } from './providers/csv';
import { calendarBookings } from './providers/ics';
export { namespace, importLimits, sourceSchemas, type SavedFile, type Resource, type SourceData } from './calendly-source';

export async function readSavedFiles(files:SavedFile[]){
 if(files.some(file=>file.name==='manifest.json'))return {...await readCalendlyFiles(files),losses:[] as SourceLoss[]};
 if(files.length>importLimits.files)throw new Error('Too many source files.');
 const names=new Set<string>(),budget={used:0,max:importLimits.maxBytes};
 const bundle:SourceBundle={paginationCursorPolicy:'page-token-v1',records:[],artifacts:[],diagnostics:[]};
 for(const file of files){
  if(!/^[a-zA-Z0-9_.-]+\.(?:json|csv|ics)$/u.test(file.name)||names.has(file.name))throw new Error('Source files need distinct simple JSON, CSV or ICS names.');names.add(file.name);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes);
  // Inspect every source field before retaining original bytes, even a field
  // which is reported as a loss and never mapped into a native record.
  const value=file.name.endsWith('.json')?JSON.parse(text):file.name.endsWith('.csv')?csvRecords(text):calendarBookings(text);
  safeValue(value,[],{artifact:file.name},'page-token-v1');
  bundle.artifacts.push({name:file.name,...await consumeBytes(file.bytes,budget,{artifact:file.name},()=>{})});
 }
 const external=names.has('source.json')?readGenericSource(files):files.length===1&&files[0].name.endsWith('.json')?readApiCapture(JSON.parse(new TextDecoder().decode(files[0].bytes))):undefined;
 if(!external)throw new Error('Choose one scheduler API capture, or the four documented template files.');
 const {data,losses,capturedAt}=external,origins=new Map<string,{name:string;sha256:string}>();
 for(const resource of Object.keys(sourceSchemas) as Resource[]){
  const seen=new Set<string>();
  for(const raw of data[resource]){
   const row=sourceSchemas[resource].parse(raw),id=String('uri'in row?row.uri:row.event_type);
   if(seen.has(id))throw new Error('Duplicate source identifier.');seen.add(id);
   const artifact=bundle.artifacts.find(a=>resource==='user'?a.name==='source.json':resource==='event_types'?a.name==='event-types.csv':resource==='schedules'||resource==='event_availability'?a.name==='availability.csv':a.name.startsWith('bookings.'))??bundle.artifacts[0];
   origins.set(`${resource}:${id}`,{name:artifact.name,sha256:artifact.sha256});
  }
 }
 if(data.user.length!==1||data.event_types.length>importLimits.events||data.scheduled_events.length>importLimits.bookings||Object.values(data).reduce((n,rows)=>n+rows.length,0)>importLimits.maxRecords)throw new Error('Import limit: one account, 100 event types, 500 bookings and 2500 source records.');
 return {bundle,data,origins,capturedAt,losses};
}
