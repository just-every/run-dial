import assert from "node:assert/strict";

export async function lifecycleWorkflows({call,json,issue,fixture,db,options,tick,slots,event}) {
 const rules=[];
 const create=async(trigger,action="email-invitee",offsetMinutes=0)=>{
  const rule=await json("/api/v1/workflows",{...options,key:`synthetic-dial-${trigger}-rule`,body:{name:`Synthetic ${trigger}`,eventTypeId:fixture.eventId,trigger,action,offsetMinutes,enabled:true,subject:`Synthetic ${trigger} proof`,text:"Your booking changed under its authorized workflow."}},201);
  rules.push(rule);assert.equal(rule.trigger,trigger);assert.equal(rule.action,action);return rule;
 };
 const rescheduled=await create("booking-rescheduled"),cancelled=await create("booking-canceled","email-hosts"),attended=await create("marked-attended"),noShow=await create("marked-no-show"),before=await create("before-start","email-invitee",15),after=await create("after-end","email-invitee",60);
 const runs=async rule=>(await json(`/api/v1/workflows/${rule.id}/runs`,options)).data;
 const book=number=>json("/api/v1/bookings",{...options,key:`synthetic-dial-workflow-lifecycle-${number}`,body:{eventTypeId:fixture.eventId,startAt:slots[10+number*2].startAt,inviteeTimezone:"UTC",name:"Synthetic lifecycle guest",email:`synthetic-dial-lifecycle-${number}${String.fromCharCode(64)}example.test`,answers:{[event.questions[0].key]:"Lifecycle proof"}}},201);
 const first=await book(0);
 await tick();assert.equal((await runs(rescheduled)).length,0);assert.equal((await runs(before)).length,0,"timed action never fires before its offset");
 const movedAt=slots[19].startAt;
 await json(`/api/v1/bookings/${first.id}/reschedule`,{...options,key:"synthetic-dial-workflow-reschedule",body:{startAt:movedAt,inviteeTimezone:"UTC"}});
 await tick();await tick();assert.equal((await runs(rescheduled)).length,1,"one reschedule fact dispatches once");
 await json("/__fixtures/deliver",{body:{}});assert.equal((await runs(rescheduled))[0].outcome,"sent");
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
 const email=`synthetic-dial-lifecycle-5${String.fromCharCode(64)}example.test`,preview=await json("/api/app/privacy/preview",{session:true,body:{email}});
 await json("/api/app/privacy/erase",{session:true,body:{email,confirmation:preview.confirmation,expiresAt:preview.expiresAt}});
 await clock(Date.parse(erased.occurrence.endAt)+2*3600000);assert.ok((await db.prepare("SELECT id FROM workflow_dispatches WHERE booking_id=?").bind(erased.id).all()).results.length===0);
 for(const rule of rules)await json(`/api/v1/workflows/${rule.id}`,{...options,method:"DELETE",key:`synthetic-dial-remove-${rule.trigger}`});
}
