import { createHash } from 'node:crypto';
/** Capacity-only account generator; business expectations never come from the importer. */
export function capacityFiles(files,eventCount=101){
 const clone=files.map(f=>({name:f.name,bytes:Buffer.from(f.bytes)}));const eventFile=clone.find(f=>f.name==='event_types-1.json');const page=JSON.parse(eventFile.bytes);
 page.collection=Array.from({length:eventCount},(_,i)=>({...page.collection[0],uri:`https://api.calendly.com/event_types/capacity-${i}`,slug:`capacity-${i}`,name:`Capacity ${i}`}));eventFile.bytes=Buffer.from(JSON.stringify(page));
 const mf=clone.find(f=>f.name==='manifest.json'),manifest=JSON.parse(mf.bytes),entry=manifest.files.find(f=>f.name===eventFile.name);entry.size=eventFile.bytes.length;entry.sha256=createHash('sha256').update(eventFile.bytes).digest('hex');mf.bytes=Buffer.from(JSON.stringify(manifest));return clone;
}

/** One supported event with many native children exercises statement expansion. */
export function windowFiles(files){
 const clone=files.map(f=>({name:f.name,bytes:Buffer.from(f.bytes)}));
 for(const file of clone){
  if(file.name==='manifest.json')continue;
  const page=JSON.parse(file.bytes);
  if(file.name==='event_types-1.json')page.collection=page.collection.slice(0,1);
  if(file.name==='scheduled_events-1.json'||file.name.startsWith('invitees-'))page.collection=[];
  if(file.name==='schedules-1.json')page.collection[0].rules=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(wday=>({type:'wday',wday,intervals:Array.from({length:140},(_,i)=>{
   const time=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
   return {from:time(i*5),to:time(i*5+4)};
  })}));
  file.bytes=Buffer.from(JSON.stringify(page));
 }
 const mf=clone.find(f=>f.name==='manifest.json'),manifest=JSON.parse(mf.bytes);
 for(const entry of manifest.files){const file=clone.find(f=>f.name===entry.name);entry.size=file.bytes.length;entry.sha256=createHash('sha256').update(file.bytes).digest('hex');}
 mf.bytes=Buffer.from(JSON.stringify(manifest));return clone;
}

/** Generate valid distinct future dates, with either closed or open overrides. */
export function overrideFiles(files,count,open=false){
 const clone=windowFiles(files),schedule=clone.find(file=>file.name==='schedules-1.json');
 const page=JSON.parse(schedule.bytes);
 page.collection[0].rules=Array.from({length:count},(_,i)=>({type:'date',date:new Date(Date.UTC(2030,0,1+i)).toISOString().slice(0,10),intervals:open?[{from:'09:00',to:'10:00'}]:[]}));
 schedule.bytes=Buffer.from(JSON.stringify(page));
 return refreshManifest(clone);
}
export function refreshManifest(files){
 const mf=files.find(file=>file.name==='manifest.json'),manifest=JSON.parse(mf.bytes);
 for(const entry of manifest.files){const file=files.find(file=>file.name===entry.name);entry.size=file.bytes.length;entry.sha256=createHash('sha256').update(file.bytes).digest('hex');}
 mf.bytes=Buffer.from(JSON.stringify(manifest));return files;
}
