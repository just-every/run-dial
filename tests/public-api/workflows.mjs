import { lifecycleWorkflows } from "./workflow-lifecycle.mjs";
import assert from "node:assert/strict";

export async function workflowJourney({call,json,issue,fixture,week,db}) {
  const limited=await issue(["event-types:manage"]);
  const input={name:"Synthetic welcome",eventTypeId:fixture.eventId,subject:"Synthetic welcome follow-through",text:"Your synthetic booking was received."};
  assert.equal((await call("/api/v1/workflows",{secret:limited.secret,key:"synthetic-dial-denied-workflow",body:input})).status,403,"managing event types grants no outbound workflow authority");
  const manager=await issue(["workflows:manage","bookings:read","bookings:write"]),options={secret:manager.secret};
  const rule=await json("/api/v1/workflows",{...options,key:"synthetic-dial-workflow",body:input},201);
  assert.equal(rule.enabled,false);
  const slots=(await json(`/api/v1/availability?eventTypeId=${fixture.eventId}&week=${week}&inviteeTimezone=UTC`,options)).slots;
  const event=await json(`/api/app/event-types/${fixture.eventId}`,{session:true});
  const book=async(index)=>json("/api/v1/bookings",{...options,key:`synthetic-dial-workflow-book-${index}`,body:{eventTypeId:fixture.eventId,startAt:slots[index*2].startAt,inviteeTimezone:"UTC",name:`Synthetic workflow guest ${index}`,email:`synthetic-dial-workflow-${index}${String.fromCharCode(64)}example.test`,answers:{[event.questions[0].key]:"Synthetic workflow"}}},201);
  const tick=async()=>{const response=await call("/cdn-cgi/local/scheduled?format=json");assert.equal(response.status,200,"the native scheduled event completes");await response.arrayBuffer();};
  const dispatches=async()=>(await db.prepare("SELECT id,outbox_id AS outboxId FROM workflow_dispatches WHERE workflow_id=? ORDER BY id").bind(rule.id).all()).results;
  await book(0);await tick();assert.equal((await dispatches()).length,0,"disabled workflows send nothing");
  await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-enable-workflow",body:{enabled:true}});
  await tick();assert.equal((await dispatches()).length,0,"enabling never replays earlier bookings");
  await book(1);await tick();await tick();assert.equal((await dispatches()).length,1,"a new booking queues one persistent workflow dispatch");
  await json("/__fixtures/deliver",{body:{}});await json("/__fixtures/deliver",{body:{}});
  const sent=async()=>{
    const wire=await json("/wire/state");
    return wire.wire_calls.filter(row=>new URL(row.url).hostname==="api.sendgrid.com"&&row.method==="POST").map(row=>JSON.parse(row.body)).filter(mail=>mail.subject===input.subject);
  };
  assert.equal((await sent()).length,1,"one actual provider message follows the explicit enablement");
  await book(2);await tick();assert.equal((await dispatches()).length,2);
  await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-disable-workflow",body:{enabled:false}});
  await json("/__fixtures/deliver",{body:{}});
  assert.equal((await sent()).length,1,"revoking the workflow stops an already queued message");
  const newest=(await dispatches()).at(-1);
  const stopped=await db.prepare("SELECT state,last_error_code AS reason FROM delivery_outbox WHERE id=?").bind(newest.outboxId).first();
  assert.equal(stopped.state,"failed");assert.equal(stopped.reason,"workflow_authority_revoked");
  await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-reenable-workflow",body:{enabled:true}});await tick();
  assert.equal((await dispatches()).length,2,"reenabling cannot replay a capture already dispatched");
  assert.ok((await json("/api/v1/workflows",options)).data.some(row=>row.id===rule.id));
  assert.equal((await json(`/api/v1/workflows/${rule.id}`,{...options,method:"DELETE",key:"synthetic-dial-remove-workflow"})).removed,true);
  assert.equal((await call(`/api/v1/workflows/${rule.id}`,options)).status,404);
  assert.equal((await call(`/api/v1/workflows/${rule.id}`,{...options,method:"DELETE",key:"synthetic-dial-remove-workflow"})).headers.get("Idempotent-Replay"),"true");
  await lifecycleWorkflows({call,json,issue,fixture,week,db,options,tick,slots,event});
}
