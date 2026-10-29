import assert from "node:assert/strict";

/** Explicit owner consent and native jobs update only a known provider contact. */
export async function crmWorkflows({call,json,issue,fixture,week,db,crmEdge,tick}) {
 const token="synthetic-dial-crm-801",before=(await json("/api/app/workflow-crm-connections",{session:true})).connections;
 assert.equal((await call("/api/app/workflow-crm-connections",{body:{name:"Synthetic refused connection",accessToken:token,consent:true}})).status,401);
 assert.equal((await call("/api/app/workflow-crm-connections",{session:true,body:{name:"Synthetic invalid connection",accessToken:"synthetic-dial-crm-refused",consent:true}})).status,422);
 assert.deepEqual((await json("/api/app/workflow-crm-connections",{session:true})).connections,before,"refused account authority enables no outbound connection");
 const connection=await json("/api/app/workflow-crm-connections",{session:true,body:{name:"Synthetic known-contact CRM",accessToken:token,consent:true}},201);
 const metadata=await json("/api/app/workflow-crm-connections",{session:true});
 assert.ok(!JSON.stringify(metadata).includes(token));
 const stored=await db.prepare("SELECT credential_ciphertext AS secret FROM workflow_crm_connections WHERE id=?").bind(connection.id).first();
 assert.ok(stored.secret&&stored.secret!==token,"provider authority is sealed at rest");
 const manager=await issue(["workflows:manage","bookings:read","bookings:write"]),options={secret:manager.secret};
 assert.equal((await call("/api/app/workflow-crm-connections",{secret:manager.secret})).status,401,"a workflow credential never reads connection settings");
 const input={name:"Synthetic HubSpot update",eventTypeId:fixture.eventId,action:"hubspot-contact-update",crmConnectionId:connection.id,enabled:true,subject:"Synthetic CRM action",text:"Only the native scheduling properties are updated."};
 const rule=await json("/api/v1/workflows",{...options,key:"synthetic-dial-crm-workflow",body:input},201);
 const event=await json(`/api/app/event-types/${fixture.eventId}`,{session:true});
 const slots=(await json(`/api/v1/availability?eventTypeId=${fixture.eventId}&week=${week}&inviteeTimezone=UTC`,options)).slots;
 const address=index=>["synthetic-dial-crm-guest-"+index,"example.test"].join(String.fromCharCode(64));
 const book=async(index,known=true)=>{
  if(known)crmEdge.contacts.set(address(index),{id:"synthetic-dial-contact-"+index,email:address(index)});
  return json("/api/v1/bookings",{...options,key:`synthetic-dial-crm-book-${index}`,body:{eventTypeId:fixture.eventId,startAt:slots[index*2].startAt,inviteeTimezone:"UTC",name:"Synthetic CRM guest",email:address(index),answers:{[event.questions[0].key]:"Private scheduling preparation"}}},201);
 };
 const process=()=>json("/__fixtures/workflow-crm/process",{body:{}});
 const runs=async()=>(await json(`/api/v1/workflows/${rule.id}/runs`,options)).data;
 const first=await book(0);await tick();await tick();await process();await process();
 assert.equal(crmEdge.writes.length,1,"one captured action updates one existing contact once");
 assert.equal(crmEdge.writes[0].id,"synthetic-dial-contact-0");
 assert.deepEqual(crmEdge.writes[0].properties,{dial_last_booking_id:first.id,dial_last_booking_state:"confirmed",dial_last_booking_start_at:first.occurrence.startAt});
 assert.ok(!JSON.stringify(crmEdge.writes).includes("Private scheduling preparation")&&!JSON.stringify(crmEdge.writes).includes("/manage/"),"answers and management authority never leave through CRM properties");
 assert.ok((await runs()).some(row=>row.bookingId===first.id&&row.outcome==="sent"));
 const unknown=await book(1,false);await tick();await process();
 assert.equal(crmEdge.writes.length,1,"a missing contact never creates a person or changes an unrelated record");
 assert.ok((await runs()).some(row=>row.bookingId===unknown.id&&row.outcome==="skipped"&&row.reason==="crm_contact_missing"));
 const firstPage=await json(`/api/v1/workflows/${rule.id}/runs?limit=1`,options);assert.ok(firstPage.nextCursor);
 const secondPage=await json(`/api/v1/workflows/${rule.id}/runs?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,options);
 assert.deepEqual(new Set([...firstPage.data,...secondPage.data].map(row=>row.bookingId)),new Set([first.id,unknown.id]));assert.equal(secondPage.nextCursor,null);
 const stopped=await book(2);await tick();
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-stop-crm",body:{enabled:false}});
 await process();assert.equal(crmEdge.writes.length,1);
 assert.ok((await runs()).some(row=>row.bookingId===stopped.id&&row.outcome==="skipped"&&row.reason==="workflow_authority_revoked"));
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-enable-crm",body:{enabled:true}});
 await tick();await process();assert.equal(crmEdge.writes.length,1,"reenabling does not replay the stopped capture");
 const erased=await book(3);await tick();
 await json(`/api/app/bookings/${erased.id}`,{session:true,method:"DELETE"},202);await process();await tick();
 assert.equal(crmEdge.writes.length,1);assert.ok(!(await runs()).some(row=>row.bookingId===erased.id),"erasure removes the queued CRM update and its local receipt");
 const revoked=await book(4);await tick();
 await json(`/api/app/workflow-crm-connections/${connection.id}`,{session:true,method:"DELETE"});
 await process();assert.equal(crmEdge.writes.length,1);
 assert.ok((await runs()).some(row=>row.bookingId===revoked.id&&row.outcome==="skipped"));
 assert.equal((await db.prepare("SELECT credential_ciphertext FROM workflow_crm_connections WHERE id=?").bind(connection.id).first()).credential_ciphertext,null);
 const fresh=await json("/api/app/workflow-crm-connections",{session:true,body:{name:"Synthetic refreshed account",accessToken:token,consent:true}},201);
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-change-crm-account",body:{crmConnectionId:fresh.id}});
 const expired=await book(5);await tick();crmEdge.reject=true;
 try{await process();}finally{crmEdge.reject=false;}
 const health=(await json("/api/app/workflow-crm-connections",{session:true})).connections.find(row=>row.id===fresh.id);
 assert.equal(health.status,"unhealthy");assert.equal(health.reason,"crm_unauthorized");assert.equal(crmEdge.writes.length,1);
 assert.ok((await runs()).some(row=>row.bookingId===expired.id&&row.outcome==="failed"&&row.reason==="crm_unauthorized"));
 const erasure=await json("/api/app/privacy/preview",{session:true,body:{email:address(0)}});
 assert.ok(erasure.externalRequests.some(row=>row.kind==="hubspot_booking_properties"&&row.processorRef==="synthetic-dial-contact-0"&&row.requested===false));
 const receipt=await json("/api/app/privacy/erase",{session:true,body:{email:address(0),confirmation:erasure.confirmation,expiresAt:erasure.expiresAt}});
 assert.equal(receipt.localComplete,true);
 assert.ok(receipt.externalRequests.some(row=>row.kind==="hubspot_booking_properties"&&row.state==="pending"&&row.reason==="hubspot_properties_require_owner_cleanup"&&row.requested===false),"local erasure never claims provider deletion");
 assert.equal(crmEdge.writes.length,1,"erasure makes no unaudited destructive CRM request");
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"DELETE",key:"synthetic-dial-remove-crm-workflow"});
}
