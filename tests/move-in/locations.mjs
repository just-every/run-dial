import assert from 'node:assert/strict';
import { assertReport } from './report-validator.mjs';
import { refreshManifest } from './capacity.mjs';

export function assertLocationChoice(report,sourceId,choice,sources){
 assertReport(report);
 const mapped=report.events.find(event=>event.sourceId===sourceId).mapped.tables.event_types[0];
 assert.deepEqual({type:mapped.location_type,label:mapped.location_label,value:mapped.location_value},choice);
 const locations=report.items.filter(item=>item.sourceId===sourceId&&item.kind==='locations');
 assert.equal(locations.length,sources.length,'Only source locations are counted');
 const changed=locations.filter(item=>item.outcome==='changed');assert.equal(changed.length,Number(sources.length>0));
 const replacement=changed[0]??report.items.find(item=>item.sourceId===sourceId&&item.kind==='eventTypes');
 for(const value of [choice.type,choice.label,choice.value].filter(Boolean))assert.ok(replacement.reason.includes(value),'Report describes the selected replacement');
 assert.ok(locations.every(item=>!item.reason.toLowerCase().includes('choose')),'Selected locations have no pending choice instruction');
 assert.equal(locations.filter(item=>item.outcome==='skipped').length,Math.max(0,sources.length-1));
}

/** Exercise each native replacement and a source containing several locations. */
export async function locationChoices(rt,files,result,databaseSnapshot){
 const sourceId='https://api.calendly.com/event_types/edges-1';
 const before=await databaseSnapshot(rt);
 for(const choice of [{type:'fixed_link',label:'Meeting',value:'https://meet.example.test/chosen'},
  {type:'in_person',label:'Office',value:'42 Replacement Street'},
  {type:'phone',label:'Host phone',value:'+61 7 5555 0100'},
  {type:'google_meet',label:'Google Meet',value:''}]){
  const preview=await result(await rt.upload('preview',files,{choices:{locations:{[sourceId]:choice}}}));
  assertLocationChoice(preview.report,sourceId,choice,[{kind:'zoom_conference'}]);
 }
 const mixed=files.map(file=>({...file,bytes:Buffer.from(file.bytes)}));
 const page=mixed.find(file=>file.name==='event_types-1.json'),data=JSON.parse(page.bytes);
 const sources=[{kind:'zoom_conference'},{kind:'physical',location:'Original office'},{kind:'custom',location:'https://meet.example.test/extra'},{kind:'outbound_call'}];
 data.collection[0].locations=sources;page.bytes=Buffer.from(JSON.stringify(data));refreshManifest(mixed);
 const choice={type:'fixed_link',label:'Selected room',value:'https://meet.example.test/selected'};
 const preview=await result(await rt.upload('preview',mixed,{choices:{locations:{[sourceId]:choice}}}));
 assertLocationChoice(preview.report,sourceId,choice,sources);
 assert.equal(preview.report.items.find(item=>item.sourceId===sourceId&&item.kind==='locations'&&item.outcome==='changed').name,'physical','The default supported location is the replaced source row');
 for(const value of [[],null]){
  data.collection[0].locations=value;page.bytes=Buffer.from(JSON.stringify(data));refreshManifest(mixed);
  const preview=await result(await rt.upload('preview',mixed,{choices:{locations:{[sourceId]:choice}}}));
  assertLocationChoice(preview.report,sourceId,choice,[]);
 }
 assert.deepEqual(await databaseSnapshot(rt),before,'Every choice preview remains inert');
}
