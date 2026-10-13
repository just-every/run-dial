import {must} from './assert.mjs';
export function selectOwned(all,known=[],prefix) {
 must(typeof prefix==='string'&&/^[a-z][a-z0-9-]+$/.test(prefix),'inventory-scope-required');
 const references=kind=>known.flatMap(record=>record.resources?.[kind]??[]);
 const match=(name,id,kind)=>name?.startsWith(prefix)||references(kind).some(row=>id?row.id===id:row.name===name);
 return {
  workers:all.workers.filter(row=>match(row.id??row.name,null,'workers')||known.some(record=>record.worker===(row.id??row.name))).map(row=>({name:row.id??row.name})),
  d1:all.d1.filter(row=>match(row.name,row.uuid,'d1')).map(row=>({name:row.name,id:row.uuid})),
  r2:all.r2.filter(row=>match(row.name,null,'r2')).map(row=>({name:row.name})),
  queues:all.queues.filter(row=>match(row.queue_name,row.queue_id,'queues')).map(row=>({name:row.queue_name,id:row.queue_id})),
  durableObjects:all.namespaces.filter(row=>(row.script??'').startsWith(prefix)||known.some(record=>(record.durableObjects??record.resources?.durableObjects??[]).some(item=>item.id===row.id))).map(row=>({name:row.script,id:row.id,class:row.class}))
 };
}
