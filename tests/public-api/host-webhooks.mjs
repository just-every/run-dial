import assert from "node:assert/strict";

/** Native host scopes apply to ordinary facts and explicit workflow transports. */
export async function hostWebhooks({call,json,issue,db,week,profile,host,event,webhookEdge}) {
 const grants=[];
 for(const id of [profile.id,host.id])grants.push(await issue(["bookings:read","bookings:write","webhooks:manage","workflows:manage"],{hostId:id}));
 const subscriptions=[];
 for(const [index,grant] of grants.entries())subscriptions.push(await json("/api/v1/webhook-subscriptions",{secret:grant.secret,key:`synthetic-dial-host-destination-${index}`,body:{endpoint:`https://receiver.synthetic.test/host-${index}`,events:["booking.created.v1","workflow.action.v1"]}},201));
 const input={name:"Synthetic host action",eventTypeId:event.id,action:"webhook",trigger:"booking-created",webhookSubscriptionId:subscriptions[1].id,enabled:true,subject:"Synthetic host webhook",text:"Native scheduling facts only."};
 const before=(await db.prepare("SELECT id FROM workflow_rules ORDER BY id").all()).results;
 assert.equal((await call("/api/v1/workflows",{secret:grants[0].secret,key:"synthetic-dial-refuse-other-host-workflow",body:input})).status,404);
 assert.deepEqual((await db.prepare("SELECT id FROM workflow_rules ORDER BY id").all()).results,before,"foreign-host authoring grants no outbound authority");
 const rule=await json("/api/v1/workflows",{secret:grants[1].secret,key:"synthetic-dial-native-host-workflow",body:input},201);
 const availability=await json(`/api/v1/availability?eventTypeId=${event.id}&week=${week}&inviteeTimezone=UTC`,{secret:grants[1].secret});
 const booking=await json("/api/v1/bookings",{secret:grants[1].secret,key:"synthetic-dial-native-host-api-booking",body:{eventTypeId:event.id,startAt:availability.slots[0].startAt,inviteeTimezone:"UTC",name:"Synthetic scoped guest",email:["synthetic-dial-host-1801","example.test"].join(String.fromCharCode(64)),answers:{}}},201);
 const first=webhookEdge.requests.length;
 await json("/__fixtures/webhooks/scheduled",{body:{}});
 await json("/__fixtures/webhooks/process",{body:{}});
 const requests=webhookEdge.requests.slice(first);
 const receiptState=(await db.prepare("SELECT event_type,state,last_error FROM webhook_deliveries WHERE subscription_id IN (?,?) ORDER BY id").bind(subscriptions[0].id,subscriptions[1].id).all()).results;
 assert.equal(requests.length,2,`the native fact and explicit action each deliver once: ${JSON.stringify({requests:requests.map(row=>({path:row.path,type:JSON.parse(row.body).type})),receipts:receiptState})}`);
 assert.ok(requests.every(row=>row.path==="/host-1"),"the other native host receives no facts or workflow data");
 assert.deepEqual(new Set(requests.map(row=>JSON.parse(row.body).type)),new Set(["booking.created.v1","workflow.action.v1"]));
 assert.ok(requests.every(row=>JSON.parse(row.body).data.bookingId===booking.id));
 const runs=(await json(`/api/v1/workflows/${rule.id}/runs`,{secret:grants[1].secret})).data;
 assert.equal(runs.length,1);assert.equal(runs[0].outcome,"sent");
 assert.equal((await call(`/api/v1/workflows/${rule.id}/runs`,{secret:grants[0].secret})).status,404);
 await json("/__fixtures/webhooks/process",{body:{}});assert.equal(webhookEdge.requests.length,first+2);
 for(const [index,subscription] of subscriptions.entries())await json(`/api/v1/webhook-subscriptions/${subscription.id}`,{secret:grants[index].secret,method:"DELETE",key:`synthetic-dial-remove-host-destination-${index}`});
 await json(`/api/v1/workflows/${rule.id}`,{secret:grants[1].secret,method:"DELETE",key:"synthetic-dial-remove-native-host-rule"});
}
