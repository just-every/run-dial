import { reportV2 } from './report-schema';
import { planD1Import, canonicalJson, sha256, type D1ImportContext, type ImportPlan, type TargetEffect } from '../../../../modules/import-kit/src/d1/index.ts';
import { deriveOpaqueToken, hashToken } from '../../platform/auth/tokens';
import { readSavedFiles, namespace, importLimits, type SavedFile } from './source';
import { readFileSource } from '../../../../modules/import-kit/src/readers/index.ts';
import { stableId, json, validZone, safeText, type Choices, type NativeValue, type Snapshot, type Accounting } from './model';
import { mapEvent } from './map-events';
import { mapBooking } from './map-bookings';
import { identityOf } from './catch-up';
import { sourceDifferences, type ImportedBooking } from './differences';
import { captureFacts, schedulingUrl } from './facts';
import type { Difference } from './difference-report';
/** A catch-up leaves every record it shares with an applied import out of its plan:
 * the import kit keeps one saved copy per source record, so those records are never
 * duplicated, overwritten or saved again, and their erasure never depends on a second copy. */
export type CatchUp={known:Set<string>;imported:ImportedBooking[]};
/** The capture's identity: its file names and digests, as the upload review binds them. */
export const captureIdentity=(artifacts:Array<{name:string;sha256:string;size:number}>)=>sha256(canonicalJson(artifacts.map(a=>({name:a.name,sha256:a.sha256,size:a.size})).sort((a,b)=>a.name.localeCompare(b.name))));
export async function planMoveIn(files:SavedFile[],choices:Choices,asOf:string,snapshot:Snapshot,context:D1ImportContext,secret:string,nonces:string[],catchUp?:CatchUp){
 if(!Number.isFinite(Date.parse(asOf)))throw new Error('Invalid as-of instant.');
 const {bundle,data,origins,capturedAt}=await readSavedFiles(files);const user=data.user[0];
 const zone=choices.zone??String(snapshot.profile?.timezone??user.timezone);if(!validZone(zone))throw new Error('Choose a valid IANA host timezone.');
 const effects=new Map<string,TargetEffect>();
 const artifact=bundle.artifacts[0],capture=captureIdentity(bundle.artifacts);
 const pending:Array<{kind:string;sourceId:string;input:ReturnType<typeof json>}>=[];
 const known=(kind:'profile'|'event'|'booking',sourceId:string)=>catchUp?.known.has(identityOf(kind,sourceId))??false;
 const alreadyHere={profile:0,eventTypes:0,bookings:0};
 function record(kind:string,sourceId:string,payload:unknown,accounting:Accounting[],value?:NativeValue){
  const origin=origins.get(`${({profile:'user',event:'event_types',booking:'scheduled_events'} as Record<string,string>)[kind]}:${sourceId}`)??artifact;
  const input=json({raw:payload,accounting});if(value)effects.set(sourceId,{targetKind:kind,targetId:stableId(sourceId),value:json(value)});
  if(catchUp){pending.push({kind,sourceId,input});return;}
  bundle.records.push({namespace,kind,sourceId,payload:input,payloadHash:sha256(canonicalJson(input)),artifactHash:origin.sha256,location:{artifact:origin.name}});
 }
 const profileId=stableId(user.uri);const profileReason=snapshot.profile?`Existing host profile retained: name ${user.name} → ${snapshot.profile.name}; zone ${user.timezone} → ${snapshot.profile.timezone}; handle ${user.slug} → ${snapshot.profile.handle}.`:'Name, source scheduling handle and chosen timezone retained.';
 let profile:NativeValue|undefined;
 if(known('profile',user.uri)){alreadyHere.profile++;if(choices.zone&&choices.zone!==snapshot.profile?.timezone)throw new Error('Change your saved host timezone in Profile before adopting that schedule zone.');}
 else{
  if(!snapshot.profile){safeText(user.name,120,'Host name');if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(user.slug)||user.slug.length>80)throw new Error('Source handle is invalid; save a valid Dial host profile first.');profile={tables:{host_profiles:[{id:profileId,singleton_key:'default',handle:user.slug,name:user.name,title:'',biography:'',timezone:zone,created_at:asOf,updated_at:asOf}],profile_focus_areas:[],social_proof_entries:[]}};}
  else if(choices.zone&&choices.zone!==snapshot.profile.timezone)throw new Error('Change your saved host timezone in Profile before adopting that schedule zone.');
  record('profile',user.uri,user,[{kind:'profile',sourceId:user.uri,name:user.name,outcome:profile?'imported':'skipped',reason:profileReason}],profile);
 }
 const events=new Map<string,NativeValue>();
 for(const raw of data.event_types){
  const payload={event:raw,schedules:data.event_availability.filter(s=>s.event_type===raw.uri)};
  if(known('event',raw.uri)){
   // Already here: left exactly as Dial holds it now; new bookings on it use that event.
   alreadyHere.eventTypes++;
   const current=snapshot.events.get(stableId(raw.uri));if(current)events.set(raw.uri,{tables:{event_types:[current]}});
   continue;
  }
  const mapped=mapEvent(raw,data,choices,snapshot,zone,asOf);record('event',raw.uri,payload,mapped.accounting,mapped.value);if(mapped.value)events.set(raw.uri,mapped.value);
 }
 if(nonces.length!==data.scheduled_events.length)throw new Error('Upload booking entropy does not match the source.');
 const {differences,rescheduleTargets}=catchUp?sourceDifferences(data,catchUp.imported,asOf):{differences:[],rescheduleTargets:new Set<string>()};
 for(const [index,raw] of [...data.scheduled_events].sort((a,b)=>a.start_time.localeCompare(b.start_time)||a.uri.localeCompare(b.uri)).entries()){
  const invitees=data.invitees.filter(i=>i.event===raw.uri);
  if(known('booking',raw.uri)){alreadyHere.bookings++;continue;}
  if(rescheduleTargets.has(raw.uri)){
   // The moved booking's person is already here; keep only the new time, not a second copy of them.
   record('booking',raw.uri,{event:{uri:raw.uri,event_type:raw.event_type,status:raw.status,start_time:raw.start_time,end_time:raw.end_time}},[{kind:'bookings',sourceId:raw.uri,name:raw.name??'Booking',startAt:raw.start_time,outcome:'skipped',bookingOutcome:'movedAtSource',reason:'The source moved an imported booking to this time. It is listed under differences: keep the Dial booking or reschedule it in Dial.'}]);
   continue;
  }
  const token=await deriveOpaqueToken(nonces[index],secret,'dial.move-in.manage.v1');const tokenHash=await hashToken(token,secret);
  const mapped=mapBooking(raw,data,events,snapshot,zone,asOf,tokenHash,context.authorization.principalId);
  record('booking',raw.uri,{event:raw,invitees},[mapped.accounting],mapped.value);
 }
 const links=data.event_types.flatMap(raw=>{const url=schedulingUrl(raw);return url?[{eventTypeId:stableId(raw.uri),url}]:[];});
 // A catch-up of bytes another import already saved is a new review: its metadata is its own source record.
 const metadataId=sha256(canonicalJson(catchUp?['catch-up',capture,asOf]:bundle.artifacts.map(a=>({name:a.name,sha256:a.sha256}))));
 record('metadata',metadataId,{asOf,zone,choices,mode:catchUp?'catch-up':'first',capture,capturedAt,sourceUser:{name:user.name,timezone:user.timezone,slug:user.slug},alreadyHere,links,differences},[]);
 if(catchUp){
  // The plan keeps an extract of only the records this catch-up reviews, plus the hash-only manifest.
  const name='catch-up-records.json',bytes=new TextEncoder().encode(canonicalJson({capturedAt,records:pending.map(item=>({kind:item.kind,sourceId:item.sourceId,raw:(item.input as {raw:unknown}).raw}))}));
  const extract=await readFileSource({paginationCursorPolicy:'page-token-v1',namespace,name,bytes,format:'json',parse:value=>({kind:'page',sourceId:name,payload:value})},{...importLimits,maxRecordBytes:importLimits.maxBytes});
  const manifest=bundle.artifacts.find(a=>a.name==='manifest.json');if(!manifest)throw new Error('Select manifest.json together with all response files.');
  bundle.artifacts=[...extract.artifacts,manifest];
  bundle.records=pending.map(item=>({namespace,kind:item.kind,sourceId:item.sourceId,payload:item.input,payloadHash:sha256(canonicalJson(item.input)),artifactHash:extract.artifacts[0].sha256,location:{artifact:name}}));
 }
 const plan=await planD1Import(bundle,{version:'1',map:source=>({effects:effects.has(source.sourceId)?[effects.get(source.sourceId)!]:[],unmapped:(source.payload as {accounting:Accounting[]}).accounting.filter(a=>a.outcome!=='imported').map(a=>({field:a.kind,reason:a.reason}))})},context);
 return {plan};
}
type Metadata={raw?:{asOf?:string;zone?:string;mode?:'first'|'catch-up';capturedAt?:string;sourceUser?:{name:string;timezone:string;slug:string};alreadyHere?:{profile:number;eventTypes:number;bookings:number}}};
export function reportFromPlan(plan:ImportPlan,state='preview',differences:Difference[]=[]){
 const metadata=plan.entries.find(e=>e.source.kind==='metadata')?.source.payload as Metadata|undefined;
 const items=plan.entries.flatMap(e=>e.erased?[]:((e.source.payload as {accounting?:Accounting[]}).accounting??[]));
 const counts:Record<string,{read:number;imported:number;changed:number;skipped:number;rejected:number}>={};
 for(const kind of ['profile','eventTypes','questions','locations','availability','overrides','settings','bookings'])counts[kind]={read:0,imported:0,changed:0,skipped:0,rejected:0};
 for(const item of items){counts[item.kind].read++;counts[item.kind][item.outcome]++;}
 const bookingCounts={read:0,toImport:0,past:0,cancelled:0,severalInvitees:0,skippedEvent:0,overlapping:0,invalid:0,movedAtSource:0};for(const item of items)if(item.kind==='bookings'){bookingCounts.read++;bookingCounts[item.bookingOutcome??'invalid']++;}
 const user=(plan.entries.find(e=>e.source.kind==='profile')?.source.payload as {raw?:{name?:string;timezone?:string;slug?:string}}|undefined)??{raw:metadata?.raw?.sourceUser};
 // Records already here are indexed without accounting; only reviewed new records offer choices.
 const reviewed=plan.entries.filter(e=>e.source.kind==='event'&&((e.source.payload as {accounting?:Accounting[]}).accounting??[]).length);
 return reportV2.parse({version:2,evidence:'synthetic-only',state,mode:metadata?.raw?.mode??'first',capturedAt:captureFacts(plan).capturedAt,alreadyHere:metadata?.raw?.alreadyHere??{profile:0,eventTypes:0,bookings:0},sourceUser:{name:user?.raw?.name??'',timezone:user?.raw?.timezone??'',handle:user?.raw?.slug??''},asOf:metadata?.raw?.asOf??'',hostZone:metadata?.raw?.zone??'',fingerprint:plan.fingerprint,counts,bookingCounts,items,differences,events:reviewed.map(e=>({sourceId:e.source.sourceId,mapped:e.effects[0]?.value??null})),erasedRecords:plan.entries.filter(e=>e.erased).length});
}
