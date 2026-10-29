import assert from "node:assert/strict";

/** Public routing and native delivery prove a source-bound, owner-only notification. */
export async function routingMailWorkflows({call,json,issue,fixture,db,tick}) {
 const grant=await issue(["workflows:manage","routing:manage","bookings:read"]),options={secret:grant.secret};
 const form=await json("/api/v1/routing-forms",{...options,key:"synthetic-dial-routing-mail-form",body:{title:"Synthetic host review",questions:[{key:"purpose",label:"Purpose",required:true}],rules:[],defaultMessage:"Please contact the host."}},201);
 const input={name:"Synthetic routing host email",eventTypeId:fixture.eventId,action:"email-hosts",trigger:"routing-without-booking",routingFormId:form.id,enabled:true,subject:"Synthetic unbooked routing review",text:"Please review the unbooked submission."};
 const restricted=await issue(["workflows:manage"]);
 assert.equal((await call("/api/v1/workflows",{secret:restricted.secret,key:"synthetic-dial-routing-mail-no-grant",body:input})).status,403);
 for(const action of ["email-invitee","hubspot-contact-update"]){
  assert.equal((await call("/api/v1/workflows",{...options,key:`synthetic-dial-routing-mail-refuse-${action}`,body:{...input,action}})).status,400,"a routing answer cannot authorize an invitee message or a provider identity");
 }
 for(const text of ["Hello {invitee full name}","Open {manage link}","Answer {answer.purpose}"]){
  assert.equal((await call("/api/v1/workflows",{...options,key:`synthetic-dial-routing-variable-${text.length}`,body:{...input,text}})).status,400,"routing has no booking-variable authority");
 }
 const rule=await json("/api/v1/workflows",{...options,key:"synthetic-dial-routing-mail-rule",body:input},201);
 assert.equal((await call(`/api/v1/workflows/${rule.id}/preview?bookingId=${fixture.eventId}`,options)).status,400);
 assert.equal((await call(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-routing-mail-invalid-patch",body:{text:"Manage {manage link}"}})).status,400);
 const mail=async()=>{
  const wire=await json("/wire/state");
  return wire.wire_calls.filter(row=>new URL(row.url).hostname==="api.sendgrid.com"&&row.method==="POST").map(row=>JSON.parse(row.body)).filter(row=>row.subject===input.subject);
 };
 const submit=async index=>{
  const body={formId:form.id,answers:{purpose:`Private synthetic routing answer ${index}`}};
  const first=await json("/api/v1/routing-submissions",{...options,key:`synthetic-dial-routing-mail-submit-${index}`,body},201);
  const replay=await json("/api/v1/routing-submissions",{...options,key:`synthetic-dial-routing-mail-submit-${index}`,body},201);
  assert.equal(replay.submissionId,first.submissionId);return first;
 };
 const runs=async()=>(await json(`/api/v1/workflows/${rule.id}/runs`,options)).data;
 const before=(await db.prepare("SELECT count(*) AS n FROM bookings").first()).n;
 const first=await submit(0);await tick();await tick();await json("/__fixtures/deliver",{body:{}});await json("/__fixtures/deliver",{body:{}});
 assert.equal((await db.prepare("SELECT count(*) AS n FROM bookings").first()).n,before,"a host notification invents no booking");
 let sent=await mail();assert.equal(sent.length,1,"one submission and its replays notify its owning host once");
 const host=await db.prepare("SELECT o.email FROM operators o JOIN operator_setup_identity setup ON setup.operator_id=o.id WHERE setup.singleton_key='default'").first();
 assert.deepEqual(sent[0].personalizations.flatMap(row=>row.to.map(to=>to.email)),[host.email],"only the owning host receives the routing notice");
 const bytes=JSON.stringify(sent[0]);assert.ok(bytes.includes(first.submissionId));assert.ok(!bytes.includes("Private synthetic routing answer")&&!bytes.includes("/manage/"),"routing email exposes neither submitted answers nor booking capabilities");
 assert.ok((await runs()).some(row=>row.submissionId===first.submissionId&&row.bookingId===null&&row.outcome==="sent"));
 const stopped=await submit(1);await tick();
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-routing-mail-stop",body:{enabled:false}});
 await json("/__fixtures/deliver",{body:{}});assert.equal((await mail()).length,1);
 assert.ok((await runs()).some(row=>row.submissionId===stopped.submissionId&&row.outcome==="skipped"&&row.reason==="workflow_authority_revoked"));
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"PATCH",key:"synthetic-dial-routing-mail-resume",body:{enabled:true}});await tick();await json("/__fixtures/deliver",{body:{}});
 assert.equal((await mail()).length,1,"reenabling cannot replay a revoked capture");
 const removed=await submit(2);await tick();
 const capture=await db.prepare("SELECT outbox_id FROM workflow_routing_mail_runs WHERE routing_submission_id=?").bind(removed.submissionId).first();assert.ok(capture);
 await json(`/api/v1/workflows/${rule.id}`,{...options,method:"DELETE",key:"synthetic-dial-routing-mail-remove"});
 await tick();await json("/__fixtures/deliver",{body:{}});assert.equal((await mail()).length,1,"removed workflow cannot send a queued routing notification");
}
