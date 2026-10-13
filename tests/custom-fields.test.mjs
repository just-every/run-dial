import assert from 'node:assert/strict';
import { before, after } from 'node:test';
import { contract } from './contract.mjs';
import { nativeFixture, targets } from './custom-fields/fixture.mjs';
import { fieldRuntime } from './custom-fields/runtime.mjs';
import { testPlatform } from './archive/fixture.mjs';
import { createArchive, restoreArchive } from './archive/artifact.mjs';
import { schemaModel, quote, validateRows } from '../scripts/archive/schema.mjs';
let f; const definitions=[]; const privateText='FIELD_PRIVATE_ANNOTATION_73742';
before(async()=>{f=await fieldRuntime();});
after(async()=>{await f?.close();});
contract('CUSTOM-001','private routes define all field types, validate values and expose all three records including booking answers',async()=>{
 for(const [entity,id] of Object.entries(targets)) {
  for(const [kind,value,options] of [['text',privateText,[]],['long_text',`${privateText}\nsecond line`,[]],['single_choice','Follow up',['Follow up','Complete']],['checkbox',false,[]]]) {
   const field=await f.json('/api/app/custom-fields',{method:'POST',body:{entity,label:`${entity} ${kind}`,kind,options}},201);definitions.push(field);
   const path=`/api/app/custom-fields/${entity}/${id}/${field.id}`;
   await f.json(path,{method:'PUT',body:{value}});
   const response=await f.request(`/api/app/custom-fields/${entity}/${id}`);assert.equal(response.headers.get('cache-control'),'no-store');
   const record=await response.json();
   assert.deepEqual(record.find(entry=>entry.id===field.id).value,value);
   const invalid=kind==='checkbox'?'true':kind==='single_choice'?'Unconfigured':true;
   assert.equal((await f.request(path,{method:'PUT',body:{value:invalid}})).status,400);
   assert.equal((await f.request(path,{method:'PUT',body:{value:kind==='long_text'?'x'.repeat(5001):'x'.repeat(501)}})).status,400);
   assert.deepEqual((await f.json(`/api/app/custom-fields/${entity}/${id}`)).find(entry=>entry.id===field.id).value,value,'rejected input leaves stored value intact');
  }
 }
 const booking=await f.json('/api/app/bookings/01ARZ3NDEKTSV4RRFFQ69G5FAB');
 assert.ok(booking.answers.length);assert.equal(booking.customFields.length,4);assert.ok(booking.customFields.some(field=>field.value===privateText));
 const first=definitions[0];
 assert.equal((await f.request(`/api/app/custom-fields/booking/01ARZ3NDEKTSV4RRFFQ69G5FAB/${first.id}`,{method:'PUT',body:{value:'wrong entity'}})).status,404);
 assert.equal((await f.request(`/api/app/custom-fields/eventType/${targets.eventType}/missing-definition`,{method:'PUT',body:{value:'unknown field'}})).status,404);
 assert.equal((await f.request(`/api/app/custom-fields/eventType/missing/${first.id}`,{method:'PUT',body:{value:'missing'}})).status,404);
 assert.equal((await f.request('/api/app/custom-fields',{method:'POST',body:{entity:'booking',label:'Choice',kind:'single_choice',options:['dup','dup']}})).status,400);
 const seed = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../seed.json',import.meta.url),'utf8'));
 for(let index=4;index<seed.limits.maxCustomFieldsPerEntity-2;index++)await f.json('/api/app/custom-fields',{method:'POST',body:{entity:'eventType',label:`Annotation ${index}`,kind:'text',options:[]}},201);
 const raced=await Promise.all(Array.from({length:6},(_,index)=>f.request('/api/app/custom-fields',{method:'POST',body:{entity:'eventType',label:`Concurrent ${index}`,kind:'text',options:[]}})));
 assert.equal(raced.filter(response=>response.status===201).length,2);assert.equal(raced.filter(response=>response.status===409).length,4);
 assert.equal((await f.json('/api/app/custom-fields')).filter(field=>field.entity==='eventType').length,seed.limits.maxCustomFieldsPerEntity);
});
contract('CUSTOM-002','native session protects annotations; export restore preserves values and erasure cascades without leaking public data',async()=>{
 const field=definitions.find(entry=>entry.entity==='booking');
 for(const [path,method,body] of [['/api/app/custom-fields','GET'],['/api/app/custom-fields','POST',{entity:'booking',label:'Unauthorized',kind:'text',options:[]}],[`/api/app/custom-fields/booking/01ARZ3NDEKTSV4RRFFQ69G5FAB`,'GET'],[`/api/app/custom-fields/booking/01ARZ3NDEKTSV4RRFFQ69G5FAB/${field.id}`,'PUT',{value:'unauthorized'}],[`/api/app/custom-fields/${field.id}`,'DELETE']])assert.equal((await f.request(path,{method,body,auth:false})).status,401);
 assert.equal((await f.request(`/api/app/custom-fields/booking/01ARZ3NDEKTSV4RRFFQ69G5FAB/${field.id}`,{method:'PUT',body:{value:'wrong origin'},originHeader:'https://other.example.test'})).status,403);
 for(const path of ['/api/public/profiles/host','/api/public/home/profile','/api/public/events/host/custom-event']){
  const response=await f.request(path,{auth:false});assert.equal(response.status,200);assert.equal((await response.text()).includes(privateText),false);
 }
 await f.json(`/api/app/bookings/${targets.booking}/cancel`,{method:'POST',body:{reason:'Operator cancellation'}});
 const delivered=await f.json('/__fields/deliver');assert.ok(delivered.results.includes('succeeded'),`production cancellation sends a real development outbox message: ${JSON.stringify(delivered)}`);
 const mail=(await f.db.prepare('SELECT * FROM delivery_outbox').all()).results;assert.equal(JSON.stringify(mail).includes(privateText),false);
 const captures=(await f.db.prepare('SELECT message FROM rer_mail_development_outbox').all()).results;assert.ok(captures.some(row=>row.message.includes('cancel')));assert.equal(JSON.stringify(captures).includes(privateText),false);
 // Actual shared archive service exports and restores the rows written through native Worker routes.
 const source=await nativeFixture(), target=await schemaModel();
 try {
  for(const name of ['ext_custom_field_values','ext_custom_field_definitions'])source.db.exec(`DELETE FROM ${quote(name)}`);
  for(const name of ['ext_custom_field_definitions','ext_custom_field_values'])for(const row of (await f.db.prepare(`SELECT * FROM ${quote(name)}`).all()).results)source.db.prepare(`INSERT INTO ${quote(name)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  const archive=await createArchive(testPlatform(source.db));const destination=testPlatform(target.db);await restoreArchive(destination,archive);assert.deepEqual(await createArchive(destination),archive);
  for(const name of ['ext_custom_field_definitions','ext_custom_field_values'])assert.deepEqual(target.db.prepare(`SELECT * FROM ${name} ORDER BY id`).all(),source.db.prepare(`SELECT * FROM ${name} ORDER BY id`).all());
  const invalid=structuredClone(archive);const choice=invalid.tables.find(t=>t.name==='ext_custom_field_values').rows.find(row=>row.kind==='single_choice');choice.value_json='"Not a configured choice"';
  const rejected=await schemaModel();try{assert.throws(()=>validateRows(invalid,rejected));assert.equal(rejected.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_definitions').get().n,0);}finally{rejected.db.close();}
  const invalidReference=structuredClone(archive);invalidReference.tables.find(t=>t.name==='ext_custom_field_values').rows[0].definition_id='missing-definition';const rejectedReference=await schemaModel();try{assert.throws(()=>validateRows(invalidReference,rejectedReference));}finally{rejectedReference.db.close();}
 }finally{source.db.close();target.db.close();}
 await f.json(`/api/app/custom-fields/${field.id}`,{method:'DELETE'});
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_values WHERE definition_id=?').bind(field.id).first()).n,0);
 assert.equal((await f.request('/api/app/availability-requests/01ARZ3NDEKTSV4RRFFQ69G5FAC',{method:'DELETE'})).status,204);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_values WHERE request_id=?').bind(targets.availabilityRequest).first()).n,0);
 assert.equal((await f.request('/api/app/bookings/01ARZ3NDEKTSV4RRFFQ69G5FAB',{method:'DELETE'})).status,202);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_values WHERE booking_id=?').bind(targets.booking).first()).n,0);
 assert.ok((await f.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_values WHERE event_type_id=?').bind(targets.eventType).first()).n>0);
 await f.request('/api/app/event-types/01ARZ3NDEKTSV4RRFFQ69G5FAA',{method:'DELETE'});
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM ext_custom_field_values').first()).n,0);
});
