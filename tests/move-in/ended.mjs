import { createHash } from 'node:crypto';
import { saved } from './runtime.mjs';

export const endedAsOf='2024-01-01T00:00:00.000Z';
// Static source occurrences: ten confirmed future bookings at import, two
// already past, and one cancelled. All ten have ended at the native clock.
const dates=['2024-01-05','2024-01-06','2024-01-07','2024-01-08','2024-01-09','2024-01-10','2024-01-11','2024-01-12','2024-01-13','2024-11-07','2023-12-01','2023-12-02','2024-02-01'];
export async function endedFiles(){
 const files=await saved('solo');
 for(const file of files.filter(file=>file.name.startsWith('scheduled_events-'))){
  const page=JSON.parse(file.bytes);
  for(const row of page.collection){
   const index=Number(row.uri.split('/').at(-1).replace('solo-',''))-1,date=dates[index];
   if(!date)throw new Error('Unknown historical source occurrence.');
   row.start_time=`${date}T15:00:00.000Z`;row.end_time=`${date}T15:30:00.000Z`;
   row.created_at='2023-01-01T00:00:00.000Z';row.updated_at=endedAsOf;
   for(const membership of row.event_memberships){membership.buffered_start_time=row.start_time;membership.buffered_end_time=row.end_time;}
  }
  file.bytes=Buffer.from(JSON.stringify(page));
 }
 const mf=files.find(file=>file.name==='manifest.json'),manifest=JSON.parse(mf.bytes);
 for(const entry of manifest.files){const file=files.find(file=>file.name===entry.name);entry.size=file.bytes.length;entry.sha256=createHash('sha256').update(file.bytes).digest('hex');}
 mf.bytes=Buffer.from(JSON.stringify(manifest));return files;
}
