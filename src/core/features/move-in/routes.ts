import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnvironment } from '../../app/context';
import { importLimits, type SavedFile } from './source';
import { linksCsv } from './switch-over';
const choicesSchema=z.object({skipEvents:z.array(z.string()).max(100).optional(),zone:z.string().max(100).optional(),skipAvailability:z.array(z.string()).max(100).optional(),locations:z.record(z.string(),z.object({type:z.enum(['google_meet','fixed_link','phone','in_person']),value:z.string().max(2000),label:z.string().max(120)})).optional()}).strict();
const input=z.object({choices:choicesSchema,asOf:z.string().datetime(),fingerprint:z.string().optional(),acknowledged:z.boolean().optional(),uploadIdentity:z.string().max(32768).optional()}).strict();
export const moveInRoutes=new Hono<AppEnvironment>()
 .use('/api/app/move-in/*',bodyLimit({maxSize:importLimits.maxBytes+1024*1024,onError:c=>c.json({error:{message:'Upload exceeds 8 MiB.'}},413)}))
 .onError((error,c)=>{
  if(error.message==='IMPORT_JOB_RETIRED'||error.message==='IMPORT_STREAM_RETIRED')return c.json({error:{code:'import_retired',message:'This import was retired by a privacy erasure and can no longer be read, resumed or undone.',receiptId:(error as Error & {receiptId?:string}).receiptId}},410);
  return c.json({error:{code:'move_in_refused',message:error.message.length<350?error.message:'The import was refused. Review the saved files and current session.'}},400);
 })
 .use('/api/app/move-in/*',async(c,next)=>{c.header('Cache-Control','no-store');await next();})
 .post('/api/app/move-in/:action',async c=>{
  const action=c.req.param('action');if(!['preview','apply'].includes(action))return c.notFound();
  const length=Number(c.req.header('content-length'));if(length>importLimits.maxBytes+1024*1024)return c.json({error:{message:'Upload exceeds 8 MiB.'}},413);
  const form=await c.req.formData();const parsed=input.parse(JSON.parse(String(form.get('options'))));
  const files:SavedFile[]=[];let total=0;for(const file of form.getAll('files')){if(!(file instanceof File))throw new Error('Choose saved response files.');total+=file.size;if(total>importLimits.maxBytes)throw new Error('Upload exceeds 8 MiB.');files.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}
  const service=c.get('services').moveIn,session=c.get('session');
  if(action==='preview'){const {report,uploadIdentity}=await service.preview(files,parsed.choices,parsed.asOf,session,parsed.uploadIdentity);return c.json({report,uploadIdentity});}
  return c.json(await service.apply(files,parsed.choices,parsed.asOf,parsed.fingerprint??'',parsed.acknowledged??false,session,parsed.uploadIdentity));
 })
 .get('/api/app/move-in/switch-over',async c=>{await c.get('services').moveIn.backfill(c.get('session'));return c.json(await c.get('services').switchOver.read());})
 .get('/api/app/move-in/switch-over/links.csv',async c=>{
  await c.get('services').moveIn.backfill(c.get('session'));
  const state=await c.get('services').switchOver.read();
  return c.body(linksCsv(state.imported?state.eventTypes:[]),200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="dial-switch-over-links.csv"'});
 })
 .post('/api/app/move-in/differences/:bookingId/keep',async c=>(await c.get('services').moveIn.keep(c.req.param('bookingId')))?c.json({decision:'kept'}):c.json({error:{code:'difference_not_open',message:'This difference has no open decision.'}},409))
 .get('/api/app/move-in/jobs',async c=>c.json({jobs:await c.get('services').moveIn.list(c.get('session'))}))
 .get('/api/app/move-in/jobs/:id',async c=>c.json(await c.get('services').moveIn.read(c.req.param('id'),c.get('session'))))
 .post('/api/app/move-in/jobs/:id/:action',async c=>{
  const service=c.get('services').moveIn,id=c.req.param('id'),session=c.get('session');
  if(c.req.param('action')==='resume')return c.json(await service.resume(id,session));
  if(c.req.param('action')==='undo')return c.json(await service.undo(id,session));return c.notFound();
 });
