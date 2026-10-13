import { mkdir, writeFile, access, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readApiSource } from '../../modules/import-kit/src/readers/index.ts';
const origin = 'https://api.calendly.com';
export const limits = { maxBytes: 8 * 1024 * 1024, maxRecords: 2500, maxRecordBytes: 512 * 1024 };
/** The transport seam is programmatic and test-only. No CLI or environment origin override. */
export async function download({ out, token, transport = fetch, sleep, asOf = new Date().toISOString() }) {
  if (!token || /[\r\n]/u.test(token)) throw new Error('A personal access token is required.');
  const destination = resolve(out);
  try { await access(destination); throw new Error('Choose a new output folder; this folder already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bundles = [], manifest = { version: 1, capturedAt: asOf, files: [] };
  const resourceCounts={};
  let bytes = 0, records = 0, requests = 0, status = 0;
  const countedTransport = async request => {
    if (++requests > 1000) throw new Error('Request limit exceeded');
    const response=await transport(request);status=response.status;return response;
  };
  async function get(resource, path) {
    const url = new URL(path, origin);
    if (url.origin !== origin) throw new Error('Source reference has an unsupported origin.');
    try {
      const bundle = await readApiSource({paginationCursorPolicy:'page-token-v1',namespace:'saved-schedule',url:url.href,token,sleep,maxRequests:1000-requests,maxRetries:3,maxRetryAfterMs:30000,
        limits:{...limits,maxBytes:limits.maxBytes-bytes,maxRecords:limits.maxRecords-records},
        parsePage(value) {
          const items = resource === 'user' ? [value.resource] : value.collection;
          if (!Array.isArray(items) || items.some(x => !x || typeof x !== 'object')) throw new Error('shape');
          return {records:items.map((payload,index)=>({kind:resource,sourceId:payload.uri ?? `${payload.event_type}:${index}`,payload})),next:value.pagination?.next_page};
        }},countedTransport);
      if(manifest.files.length+bundle.artifacts.length>600)throw new Error('File limit exceeded');
      for (const [index, artifact] of bundle.artifacts.entries()) {
        const name = `${resource}-${bundles.length + 1}-${index+1}.json`;
        manifest.files.push({name,resource,page:index+1,size:artifact.size,sha256:artifact.sha256,capturedAt:asOf});
        bundles.push({name,bytes:Buffer.from(artifact.original.base64,'base64')}); bytes += artifact.size;
      }
      records += bundle.records.length;resourceCounts[resource]=(resourceCounts[resource]??0)+bundle.records.length;
      return bundle.records.map(record=>record.payload);
    } catch (error) {
      const code=String(error.code ?? 'SOURCE_NETWORK_FAILED');
      if(status===401)throw new Error('The token was refused (401).');
      if(status===403)throw new Error(`Access to ${resource} was refused (403); grant read access for this resource.`);
      throw new Error(`Download stopped for ${resource} (${code}). Check access and limits, then retry later. Nothing was saved.`);
    }
  }
  const [user] = await get('user','/users/me');
  if (!user?.uri) throw new Error('The user response is missing its identity.');
  const query = new URLSearchParams({user:user.uri,count:'100'});
  const types = await get('event_types',`/event_types?${query}`);
  if(types.length>100)throw new Error('Download exceeds Dial’s limit of 100 event types. Nothing was saved.');
  await get('schedules',`/user_availability_schedules?${query}`);
  for (const type of types) await get('event_availability',`/event_type_availability_schedules?${new URLSearchParams({event_type:type.uri})}`);
  // Active and cancelled future events: a catch-up needs cancellations and source reschedules (cancelled with a rescheduled invitee) to list them as differences.
  const events = await get('scheduled_events',`/scheduled_events?${query}&min_start_time=${encodeURIComponent(asOf)}`);
  if(events.length>500)throw new Error('Download exceeds Dial’s limit of 500 scheduled events. Nothing was saved.');
  for (const event of events) {
    const url=new URL(event.uri);
    if(url.origin!==origin || !/^\/scheduled_events\/[^/]+$/u.test(url.pathname))throw new Error('Invalid scheduled-event reference.');
    await get('invitees',`${url.pathname}/invitees?count=100`);
  }
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  if(bytes+Buffer.byteLength(manifestText)>limits.maxBytes)throw new Error('Download and manifest exceed the 8 MiB upload limit. Nothing was saved.');
  const staging = resolve(dirname(destination),`.${basename(destination)}-${randomUUID()}`);
  await mkdir(staging,{mode:0o700});
  try {
    for(const file of bundles)await writeFile(resolve(staging,file.name),file.bytes,{mode:0o600,flag:'wx'});
    await writeFile(resolve(staging,'manifest.json'),manifestText,{mode:0o600,flag:'wx'});
    // The exclusive mkdir is the publication reservation: never replace an existing folder.
    await mkdir(destination,{mode:0o700});
    try { await rename(staging,destination); } catch(error) { await rmdir(destination).catch(()=>{});throw error; }
  } catch(error) { await rm(staging,{recursive:true,force:true});throw new Error(error.code==='EEXIST'?'Choose a new output folder; this folder already exists.':'Could not save the folder. Check available disk space and permissions.'); }
  const counts=Object.fromEntries([...new Set(manifest.files.map(f=>f.resource))].map(kind=>[kind,manifest.files.filter(f=>f.resource===kind).length]));
  return `${Object.entries(counts).map(([kind,count])=>`${kind}: ${resourceCounts[kind]??0} records in ${count} pages`).join('; ')}. Upload this folder in Dial: Settings → Move in`;
}
