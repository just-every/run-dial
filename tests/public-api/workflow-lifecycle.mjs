import { textBody, wireMail } from "../booking-wire/mail-contracts.mjs";
import { confirmAuthLink } from "../auth-client.mjs";
import assert from "node:assert/strict";

export async function lifecycleWorkflows({call,json,issue,fixture,db,options,tick,slots,event}) {
 const rules=[];
 const create=async(trigger,action="email-invitee",offsetMinutes=0)=>{
  const rule=await json("/api/v1/workflows",{...options,key:`synthetic-dial-${trigger}-rule`,body:{name:`Synthetic ${trigger}`,eventTypeId:fixture.eventId,trigger,action,offsetMinutes,enabled:true,subject:`Synthetic ${trigger} proof`,text:trigger==="booking-rescheduled"?`Hello {invitee full name}. {event name}: {date and time}. Answer: {answer.${event.questions[0].key}}. {manage link}`:"Your booking changed under its authorized workflow."}},201);
  rules.push(rule);assert.equal(rule.trigger,trigger);assert.equal(rule.action,action);return rule;
 };
 const rescheduled=await create("booking-rescheduled"),cancelled=await create("booking-canceled","email-hosts"),attended=await create("marked-attended"),noShow=await create("marked-no-show"),before=await create("before-start","email-invitee",15),after=await create("after-end","email-invitee",60);
 let observer=options;
 const runs=async rule=>(await json(`/api/v1/workflows/${rule.id}/runs`,observer)).data;
 const book=number=>json("/api/v1/bookings",{...options,key:`synthetic-dial-workflow-lifecycle-${number}`,body:{eventTypeId:fixture.eventId,startAt:slots[10+number*2].startAt,inviteeTimezone:"UTC",name:"Synthetic lifecycle guest",email:`synthetic-dial-lifecycle-${number}${String.fromCharCode(64)}example.test`,answers:{[event.questions[0].key]:"Lifecycle proof"}}},201);
 const first=await book(0);
 const preview=await json(`/api/v1/workflows/${rescheduled.id}/preview?bookingId=${first.id}`,options);
 assert.ok(preview.text.includes("Synthetic lifecycle guest")&&preview.text.includes("Lifecycle proof")&&preview.text.includes("UTC"));
 assert.ok(preview.text.includes("[Invitee management link]")&&!preview.text.includes("/manage/"),"API previews render real values without any invitee capability");
 const configOnly=await issue(["workflows:manage"]);
 assert.equal((await call(`/api/v1/workflows/${rescheduled.id}/preview?bookingId=${first.id}`,{secret:configOnly.secret})).status,403,"template configuration grants no preview of booking data");
 const countBefore=(await db.prepare("SELECT id FROM workflow_rules").all()).results.length;
 for(const [text,action] of [["{unknown}","email-invitee"],["{answer.q_unavailable000}","email-invitee"],["{manage link}","email-hosts"]]){
  const refused=await call("/api/v1/workflows",{...options,key:"synthetic-dial-invalid-template",body:{name:"Synthetic refused template",eventTypeId:fixture.eventId,subject:"Synthetic template",text,action}});
  assert.equal(refused.status,400);assert.equal((await refused.json()).error.code,"invalid_template");
 }
 assert.equal((await db.prepare("SELECT id FROM workflow_rules").all()).results.length,countBefore,"invalid variables create no outbound rule");
 await db.prepare("UPDATE event_questions SET private=1 WHERE event_type_id=?").bind(fixture.eventId).run();
 try{
  const denied=await call(`/api/v1/workflows/${rescheduled.id}/preview?bookingId=${first.id}`,options);assert.equal(denied.status,409);assert.ok(!JSON.stringify(await denied.json()).includes("Lifecycle proof"),"a newly private answer is absent from preview responses");
  const privateRule=await call("/api/v1/workflows",{...options,key:"synthetic-dial-private-answer",body:{name:"Synthetic private answer",eventTypeId:fixture.eventId,subject:"Synthetic refusal",text:`{answer.${event.questions[0].key}}`}});assert.equal(privateRule.status,400);assert.equal((await privateRule.json()).error.code,"invalid_template");
 }finally{await db.prepare("UPDATE event_questions SET private=0 WHERE event_type_id=?").bind(fixture.eventId).run();}
 assert.equal((await db.prepare("SELECT id FROM workflow_rules").all()).results.length,countBefore,"private answer refusal creates no outbound authority");
 await tick();assert.equal((await runs(rescheduled)).length,0);assert.equal((await runs(before)).length,0,"timed action never fires before its offset");
 const movedAt=slots[19].startAt;
 await json(`/api/v1/bookings/${first.id}/reschedule`,{...options,key:"synthetic-dial-workflow-reschedule",body:{startAt:movedAt,inviteeTimezone:"UTC"}});
 await tick();await tick();assert.equal((await runs(rescheduled)).length,1,"one reschedule fact dispatches once");
 await json("/__fixtures/deliver",{body:{}});assert.equal((await runs(rescheduled))[0].outcome,"sent");
 const rendered=wireMail(await json("/wire/state")).find(mail=>mail.subject==="Synthetic booking-rescheduled proof");
 assert.ok(rendered&&textBody(rendered).includes("Synthetic lifecycle guest")&&textBody(rendered).includes("Lifecycle proof")&&textBody(rendered).includes("/manage/"),"only actual invitee mail receives the rendered current management link");
 await json(`/api/v1/bookings/${first.id}/cancel`,{...options,key:"synthetic-dial-workflow-cancel",body:{}});
 await tick();await tick();await json("/__fixtures/deliver",{body:{}});
 const hostCount=(await db.prepare("SELECT id FROM operators WHERE removed_at IS NULL").all()).results.length;
 const cancelRuns=await runs(cancelled);assert.equal(cancelRuns.length,hostCount);assert.ok(cancelRuns.every(row=>row.outcome==="sent"),"cancellation action mails each authorized host once");
 const timed=await book(1),originalStart=Date.parse(timed.occurrence.startAt);
 const clock=(now,deliver=false)=>json("/__fixtures/workflows-run",{body:{now:new Date(now).toISOString(),deliver}});
 await clock(originalStart-16*60000);assert.equal((await runs(before)).length,0);
 await clock(originalStart-15*60000,true);await clock(originalStart-15*60000,true);
 assert.equal((await runs(before)).length,1);assert.equal((await runs(before))[0].outcome,"sent");
 const oldEnd=Date.parse(timed.occurrence.endAt);
 await clock(oldEnd+59*60000);assert.equal((await runs(after)).length,0);
 // Rescheduling changes the durable after-end source; its old due time cannot send.
 const newStart=new Date(Date.parse(slots[23].startAt)+86400000).toISOString();
 // Use a native slot from a refreshed public availability range.
 const available=await json(`/api/v1/availability?eventTypeId=${fixture.eventId}&week=${newStart.slice(0,10)}&inviteeTimezone=UTC`,options);
 const destination=available.slots.find(row=>Date.parse(row.startAt)>oldEnd+2*3600000);assert.ok(destination);
 await json(`/api/v1/bookings/${timed.id}/reschedule`,{...options,key:"synthetic-dial-timed-move",body:{startAt:destination.startAt,inviteeTimezone:"UTC"}});
 await clock(oldEnd+60*60000,true);assert.equal((await runs(after)).length,0,"old occurrence creates no follow-up after a move");
 await clock(Date.parse(destination.endAt)+60*60000,true);await clock(Date.parse(destination.endAt)+60*60000,true);
 assert.equal((await runs(after)).length,1);assert.equal((await runs(after))[0].outcome,"sent");
 const canceledTimers=await book(2);
 await json(`/api/v1/bookings/${canceledTimers.id}/cancel`,{...options,key:"synthetic-dial-cancel-timers",body:{}});
 await clock(Date.parse(canceledTimers.occurrence.endAt)+2*3600000);
 assert.ok(!(await runs(before)).some(row=>row.bookingId===canceledTimers.id));assert.ok(!(await runs(after)).some(row=>row.bookingId===canceledTimers.id),"cancelled booking has no timed action");
 for(const [number,status,rule] of [[3,"attended",attended],[4,"no_show",noShow]]){
  const row=await book(number);assert.equal((await call("/__fixtures/booking-ended",{body:{id:row.id}})).status,204);
  await json(`/api/v1/bookings/${row.id}/attendance`,{...options,key:`synthetic-dial-mark-${status}`,body:{status,note:"Synthetic attendance"}});
  await tick();await tick();await json("/__fixtures/deliver",{body:{}});assert.ok((await runs(rule)).some(item=>item.bookingId===row.id&&item.outcome==="sent"));
 }
 // Foreign team credentials cannot read delivery outcomes or change outbound rules.
 const empty=await json("/api/v1/teams",{secret:(await issue(["event-types:manage"])).secret,key:"synthetic-dial-workflow-other-team",body:{name:"Synthetic other team",eventTypeIds:[]}},201);
 const foreign=await issue(["workflows:manage"],{teamId:empty.id});
 assert.equal((await call(`/api/v1/workflows/${before.id}/runs`,{secret:foreign.secret})).status,404);
 assert.equal((await call(`/api/v1/workflows/${before.id}`,{secret:foreign.secret,method:"PATCH",key:"synthetic-dial-foreign-workflow",body:{enabled:false}})).status,404);
 // Erasure removes queued actions and receipts and a later sweep cannot replay them.
 const erased=await book(5);await tick();
 const email=`synthetic-dial-lifecycle-5${String.fromCharCode(64)}example.test`,erasurePreview=await json("/api/app/privacy/preview",{session:true,body:{email}});
 await json("/api/app/privacy/erase",{session:true,body:{email,confirmation:erasurePreview.confirmation,expiresAt:erasurePreview.expiresAt}});
 await clock(Date.parse(erased.occurrence.endAt)+2*3600000);assert.ok((await db.prepare("SELECT id FROM workflow_dispatches WHERE booking_id=?").bind(erased.id).all()).results.length===0);
 const secondAddress=`synthetic-dial-second-owner${String.fromCharCode(64)}example.test`;
 await json("/api/app/operators",{session:true,body:{email:secondAddress}},201);
 const invitation=(await json("/__test/mail")).find(row=>row.message.to.includes(secondAddress));assert.ok(invitation);
 const link=invitation.message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0];
 const replacementSession=await confirmAuthLink(link);assert.equal(replacementSession.status,303);
 const revokedRule=await create("booking-created"),revokedBooking=await book(6);await tick();
 const queued=await runs(revokedRule);assert.ok(queued.some(row=>row.bookingId===revokedBooking.id&&row.outcome==="pending"));
 const owner=await db.prepare("SELECT operator_id AS id FROM workflow_rules WHERE id=?").bind(revokedRule.id).first();
 const replacementCookie=replacementSession.headers.get("set-cookie").split(";")[0];
 const surviving=await json("/api/app/api-credentials",{session:true,operatorCookie:replacementCookie,body:{name:"Synthetic surviving owner",scopes:["workflows:manage","bookings:read"],expiresAt:new Date(Date.now()+86400000).toISOString()}},201);
 const ownerConnection=await json("/api/app/workflow-crm-connections",{session:true,body:{name:"Synthetic deactivation grant",accessToken:"synthetic-dial-crm-801",consent:true}},201);
 await db.prepare("UPDATE oa_operators SET status='inactive' WHERE id=?").bind(owner.id).run();
 try{await json("/__fixtures/deliver",{body:{}});}finally{await db.prepare("UPDATE oa_operators SET status='active' WHERE id=?").bind(owner.id).run();}
 assert.equal((await call(`/api/v1/workflows/${revokedRule.id}/runs`,options)).status,401,"restoring the creator cannot revive their revoked machine credential");
 observer={secret:surviving.secret};
 const revokedGrant=await json(`/api/v1/workflows/${revokedRule.id}`,observer);assert.equal(revokedGrant.enabled,false);assert.ok(revokedGrant.authorityRevokedAt,"restoring the owner cannot revive a revoked workflow grant");
 const providerGrant=(await json("/api/app/workflow-crm-connections",{session:true,operatorCookie:replacementCookie})).connections.find(row=>row.id===ownerConnection.id);
 assert.equal(providerGrant.status,"revoked");assert.equal(providerGrant.reason,"owner_authority_revoked");
 assert.equal((await db.prepare("SELECT credential_ciphertext FROM workflow_crm_connections WHERE id=?").bind(ownerConnection.id).first()).credential_ciphertext,null,"role restoration cannot recover a removed provider credential");
 assert.ok((await runs(revokedRule)).some(row=>row.bookingId===revokedBooking.id&&row.outcome==="skipped"&&row.reason==="workflow_authority_revoked"),"removing the enabling owner's authority stops queued outbound mail");
 await tick();assert.equal((await runs(revokedRule)).filter(row=>row.bookingId===revokedBooking.id).length,1,"reactivation cannot replay a revoked delivery");
 for(const rule of rules)await json(`/api/v1/workflows/${rule.id}`,{...observer,method:"DELETE",key:`synthetic-dial-remove-${rule.trigger}`});
 return {cookie:replacementSession.headers.get("set-cookie").split(";")[0]};
}
