import { z } from 'zod';
import { readFileSource } from '../../../../modules/import-kit/src/readers/index.ts';
import type { Json, SourceBundle } from '../../../../modules/import-kit/src/types.ts';
export const namespace = 'saved-schedule';
export const importLimits = { maxBytes: 8 * 1024 * 1024, maxRecords: 2500, maxRecordBytes: 512 * 1024, files: 600, events: 100, bookings: 500 };
const uri=z.string().url().max(512);
const text=z.string().max(4000);
const rule=z.object({type:z.enum(['wday','date']),wday:z.string().optional(),date:z.string().optional(),intervals:z.array(z.object({from:z.string(),to:z.string()}))});
const question=z.object({name:text,type:z.string(),position:z.number().int(),enabled:z.boolean(),required:z.boolean(),answer_choices:z.array(text),include_other:z.boolean()}).passthrough();
export const sourceSchemas={
 user:z.object({uri,name:text,slug:z.string(),timezone:z.string()}).passthrough(),
 event_types:z.object({uri,name:text.nullable(),slug:z.string().nullable(),duration:z.number(),color:z.string(),active:z.boolean(),secret:z.boolean(),kind:z.string(),type:z.string(),pooling_type:z.string().nullable(),description_plain:text.nullable(),custom_questions:z.array(question),locations:z.array(z.object({kind:z.string().optional(),location:text.optional(),phone_number:z.string().optional()}).passthrough()).nullable(),duration_options:z.array(z.number()).nullable()}).passthrough(),
 schedules:z.object({uri,user:uri,timezone:z.string(),rules:z.array(rule),default:z.boolean(),name:text}).passthrough(),
 event_availability:z.object({event_type:uri,availability_rule:z.object({timezone:z.string().optional(),uri:uri.optional(),rules:z.array(rule).optional()}).passthrough()}).passthrough(),
 scheduled_events:z.object({uri,event_type:uri,name:text.nullable(),status:z.string(),start_time:z.string(),end_time:z.string(),created_at:z.string(),location:z.record(z.string(),z.unknown()),invitees_counter:z.object({active:z.number(),total:z.number(),limit:z.number()}),event_memberships:z.array(z.record(z.string(),z.unknown())),event_guests:z.array(z.unknown())}).passthrough(),
 invitees:z.object({uri,event:uri,name:text,email:z.string(),timezone:z.string().nullable(),status:z.string(),created_at:z.string(),questions_and_answers:z.array(z.object({question:text,answer:text,position:z.number().int()}))}).passthrough(),
};
export type Resource=keyof typeof sourceSchemas;
export type SourceData={ [K in Resource]:z.infer<(typeof sourceSchemas)[K]>[] };
const manifestSchema=z.object({version:z.literal(1),capturedAt:z.string().datetime(),files:z.array(z.object({name:z.string().regex(/^[a-zA-Z0-9_.-]+\.json$/u),resource:z.enum(['user','event_types','schedules','event_availability','scheduled_events','invitees']),page:z.number().int().positive(),size:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/u),capturedAt:z.string().datetime()}).strict()).min(1).max(importLimits.files)}).strict();
export type SavedFile={name:string;bytes:Uint8Array};
export async function readCalendlyFiles(files:SavedFile[]) {
 if(files.length>importLimits.files+1)throw new Error('Too many files (maximum 601).');
 const names=new Set<string>();let size=0;
 for(const file of files){if(names.has(file.name))throw new Error(`Duplicate file: ${file.name}`);names.add(file.name);size+=file.bytes.length;}
 if(size>importLimits.maxBytes)throw new Error('Saved data exceeds the 8 MiB total limit.');
 const manifestFile=files.find(file=>file.name==='manifest.json');if(!manifestFile)throw new Error('Select manifest.json together with all response files.');
 const manifestBundle=await readFileSource({paginationCursorPolicy:'page-token-v1',namespace,name:'manifest.json',bytes:manifestFile.bytes,format:'json',parse:value=>({kind:'manifest',sourceId:'manifest',payload:manifestSchema.parse(value) as Json})},importLimits);
 const manifest=manifestSchema.parse(manifestBundle.records[0].payload);
 if(manifest.files.length!==files.length-1)throw new Error('Select exactly the files listed in manifest.json.');
 const bundle:SourceBundle={paginationCursorPolicy:'page-token-v1',records:[],artifacts:[],diagnostics:[]};
 const data:SourceData={user:[],event_types:[],schedules:[],event_availability:[],scheduled_events:[],invitees:[]};
 const origins=new Map<string,{name:string;sha256:string}>();
 const ids=new Set<string>();const listed=new Set<string>();
 for(const item of manifest.files){
  if(listed.has(item.name))throw new Error(`Duplicate manifest file: ${item.name}`);listed.add(item.name);
  const file=files.find(f=>f.name===item.name);if(!file)throw new Error(`Missing file: ${item.name}`);
  try {
   // A page record retains empty-page envelopes too; every exact input byte is held by the kit.
   const read=await readFileSource({paginationCursorPolicy:'page-token-v1',namespace,name:file.name,bytes:file.bytes,format:'json',parse:value=>{
    const root=z.object({resource:z.unknown().optional(),collection:z.array(z.unknown()).optional(),pagination:z.object({next_page:z.string().nullable().optional()}).passthrough().optional()}).passthrough().parse(value);
    const rows=item.resource==='user'?[root.resource]:root.collection;if(!rows)throw new Error('shape');
    for(const raw of rows){const row=sourceSchemas[item.resource].parse(raw);const id=String('uri'in row?row.uri:row.event_type);const key=`${item.resource}:${id}`;if(ids.has(key))throw new Error('duplicate source identifier');ids.add(key);origins.set(key,{name:item.name,sha256:item.sha256});(data[item.resource] as unknown[]).push(row);}
    return {kind:'page',sourceId:item.name,payload:value};
   }},importLimits);
   if(read.artifacts[0].sha256!==item.sha256||read.artifacts[0].size!==item.size)throw new Error('manifest hash or size mismatch');
   bundle.artifacts.push(...read.artifacts);
  }catch(error){throw new Error(`${file.name}: invalid JSON, documented shape, duplicate identifier, or manifest digest (${error instanceof Error&&error.message==='duplicate source identifier'?'duplicate source identifier':'validation failed'}).`);}
 }
 if(data.user.length!==1)throw new Error('The saved data must contain exactly one user.');
 if(data.event_types.length>importLimits.events||data.scheduled_events.length>importLimits.bookings)throw new Error('Import limit: 100 event types and 500 scheduled events.');
 if(Object.values(data).reduce((n,rows)=>n+rows.length,0)>importLimits.maxRecords)throw new Error('Import limit: 2500 source records.');
 // The manifest contains only hashes and capture metadata; retain it without a second personal-data copy.
 bundle.artifacts.push(...manifestBundle.artifacts);
 return {bundle,data,capturedAt:manifest.capturedAt,origins};
}
