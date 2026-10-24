import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
/** PAY-006 through the native operator, signed webhook and accounting doors.
 * Person markers include +, outside provider UUID alphabets, including in valid email local parts. */
export async function reconciliationProbes({call,data,state,hold,slot,day,complete,webhook,stripeEvent,signature,probe}){
  const person=await complete(await hold('coaching',await slot('coaching',day(35)),'synthetic-dial-person+200@example.test','synthetic-dial-person+200',true));
  const id=person.booking.id,intent=person.paid.payment_intent;
  const refund={id:'synthetic-dial-201',amount:500,currency:'usd',status:'succeeded',payment_intent:intent};
  const charge={id:'synthetic-dial-202',payment_intent:intent,currency:'usd',amount:2500,amount_refunded:500,refunds:{data:[refund],has_more:false}};
  await probe('PAY-006 signed dashboard refund reconciles once without moving money',async()=>{
    const before=await state(),event=stripeEvent('charge.refunded',charge),timestamp=Math.floor(Date.now()/1000)-600;
    await call('/api/webhooks/stripe',event,401,'POST',{'stripe-signature':'t=1,v1=forged',anonymous:'1'});
    await call('/api/webhooks/stripe',event,401,'POST',{'stripe-signature':signature(event,timestamp),anonymous:'1'});
    await webhook(stripeEvent('charge.refunded',charge,'synthetic-dial-foreign'),401);
    assert.deepEqual((await state()).payment_processor_facts,before.payment_processor_facts);
    await webhook(event);await webhook(event);
    const money=(await data(`/api/app/bookings/${id}/money`)).money;
    assert.equal(money.ledger.refundedCents,500);assert.equal(money.ledger.refundableCents,2000);
    assert.equal(money.reconciliation.filter(f=>f.processorRef===refund.id).length,1);
    assert.equal(money.reconciliation.find(f=>f.processorRef===refund.id).disagreement,1);
    assert.equal((await state()).wire_calls.filter(c=>c.method==='POST'&&/\/v1\/(refunds|payment_intents)/u.test(new URL(c.url).pathname)).length,before.wire_calls.filter(c=>c.method==='POST'&&/\/v1\/(refunds|payment_intents)/u.test(new URL(c.url).pathname)).length,'reconciliation never moves money');
    await call(`/api/app/bookings/${id}/refunds`,{amountCents:2001,reason:'synthetic-dial-203',idempotencyKey:randomUUID()},400);
    console.log('PAY-006: PASS dashboard refund, invalid signature/stale/foreign refusal, duplicate once, refundable cap and no money-moving call');
  });
  await probe('PAY-006 dispute flags and closes without reopening on old events',async()=>{
    const transaction=await data('/__fixtures/payments/payout',{intentId:intent,payoutId:'synthetic-dial-209'});
    await webhook(stripeEvent('charge.succeeded',{id:'synthetic-dial-202',payment_intent:intent,currency:'usd',amount:2500,balance_transaction:transaction.id}));
    await webhook(stripeEvent('payout.paid',{id:'synthetic-dial-209'}));await webhook(stripeEvent('payout.paid',{id:'synthetic-dial-209'}));
    const facts=(await data(`/api/app/bookings/${id}/money`)).money.reconciliation;
    assert.equal(facts.find(f=>f.kind==='fee').amountCents,100);assert.equal(facts.filter(f=>f.kind==='payout').length,1);assert.equal(facts.find(f=>f.kind==='payout').processorRef,'synthetic-dial-209');
    const dispute={id:'synthetic-dial-204',payment_intent:intent,currency:'usd',amount:2500,status:'needs_response'};
    const created=stripeEvent('charge.dispute.created',dispute);await webhook(created);await webhook(created);
    assert.equal((await data('/api/app/payments/reconciliation')).rows.find(r=>r.processorRef===dispute.id).disagreement,1);
    await webhook(stripeEvent('charge.dispute.closed',{...dispute,status:'won'}));await webhook(created);
    const closed=(await data('/api/app/payments/reconciliation')).rows.find(r=>r.processorRef===dispute.id);assert.equal(closed.status,'won');assert.equal(closed.disagreement,0);
    const csv=await(await call('/api/app/payments/export.csv')).text();assert.ok(csv.includes(refund.id)&&csv.includes(dispute.id)&&csv.includes('synthetic-dial-person+200'));assert.ok(!csv.includes('/manage/')&&!csv.includes('synthetic-dial-100'));
    console.log('PAY-006: PASS charge and processor fee lookup, payout allocation/dedupe, dispute flag/close/stale replay and credential-free CSV');
  });
  await probe('PAY-006 QuickBooks OAuth refusals store no credential and valid state is single-use',async()=>{
    const start=async()=>new URL((await call('/api/app/payments/accounting/oauth/start',undefined,302)).headers.get('location'));
    const cb=(params,expected=400,headers)=>call('/api/payments/accounting/oauth/callback?'+new URLSearchParams(params),undefined,expected,'GET',headers);
    await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206'});
    const first=await start(),state=first.searchParams.get('state'),[body]=state.split('.'),decoded=JSON.parse(Buffer.from(body,'base64url'));
    const sign=value=>{const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256','synthetic-dial-booking-wire-synthetic-local-session-secret:accounting.v1').update(body).digest('base64url');};
    await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state:body+'.forged'});
    await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state:sign({...decoded,sessionId:'synthetic-dial-207'})});
    await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state:sign({...decoded,issuedAt:new Date(Date.now()-660000).toISOString()})});
    await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state},400,{anonymous:'1'});
    await call('/__fixtures/payments/accounting-expired',{},204);await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state});
    assert.equal((await data('/api/app/payments/accounting')).state,'disconnected');
    const fresh=(await start()).searchParams.get('state');await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state:fresh},302);await cb({code:'synthetic-dial-205',realmId:'synthetic-dial-206',state:fresh});
    const connections=(await stateSnapshot()).accounting_connections;
    assert.equal(connections.length,1);assert.ok(!JSON.stringify(connections).includes('synthetic-dial-100'));
    console.log('PAY-006: PASS QuickBooks missing/unsigned/mismatched/anonymous/expired/replayed OAuth state and sealed token custody');
    async function stateSnapshot(){return (await data('/wire/state'));}
  });
  await probe('PAY-006 QuickBooks one receipt per captured payment survives response loss, repeat and concurrent export',async()=>{
    const accounts=await data('/api/app/payments/accounting/accounts');await call('/api/app/payments/accounting/mapping',{accountId:accounts.accounts[0].id},200,'PUT');
    await data('/wire/control',{name:'accounting-response-lost',value:1});await call('/api/app/payments/accounting/export',{},503);
    await data('/api/app/payments/accounting/export',{});await Promise.all([data('/api/app/payments/accounting/export',{}),data('/api/app/payments/accounting/export',{})]);
    const snapshot=await data('/__fixtures/payments/accounting-state');
    assert.equal(snapshot.receipts.length,snapshot.exports.length);assert.ok(snapshot.receipts.length>0);
    assert.equal(new Set(snapshot.exports.map(row=>row.payment_ref)).size,snapshot.receipts.length);
    assert.ok(snapshot.exports.every(row=>row.state==='exported'&&row.receipt_id));
    for(const receipt of snapshot.receipts){assert.ok(!JSON.stringify(receipt).includes('@'));assert.ok(!JSON.stringify(receipt).includes('/manage/'));assert.ok(!receipt.CustomerRef);assert.equal(receipt.Line[0].SalesItemLineDetail.ItemRef.value,(await state()).accounting_connections[0].item_id);}
    const refundRow=(await data('/api/app/payments/reconciliation')).rows.find(r=>r.processorRef==='synthetic-dial-201');
    await data(`/api/app/bookings/${id}/reconciliation/acknowledge`,{processorRef:refundRow.processorRef});
    await webhook(stripeEvent('charge.refunded',charge));
    assert.equal((await data('/api/app/payments/reconciliation')).rows.find(r=>r.processorRef===refundRow.processorRef).disagreement,0,'explicit acknowledgement survives duplicate events');
    const count=snapshot.receipts.length;
    await data('/wire/control',{name:'accounting-revoked',value:1});await call('/api/app/payments/accounting/export',{},409);
    assert.equal((await data('/api/app/payments/accounting')).state,'unhealthy');await call('/api/app/payments/accounting/export',{},409);
    await data('/wire/control',{name:'accounting-revoked',value:0});assert.equal((await data('/__fixtures/payments/accounting-state')).receipts.length,count);
    const reconnect=new URL((await call('/api/app/payments/accounting/oauth/start',undefined,302)).headers.get('location')).searchParams.get('state');
    await call('/api/payments/accounting/oauth/callback?'+new URLSearchParams({state:reconnect,code:'synthetic-dial-210',realmId:'synthetic-dial-206'}),undefined,302);
    await call('/__fixtures/payments/accounting-token-expired',{},204);await data('/wire/control',{name:'accounting-token-refused',value:1});
    await call('/api/app/payments/accounting/accounts',undefined,409);assert.equal((await data('/api/app/payments/accounting')).state,'unhealthy');
    await data('/wire/control',{name:'accounting-token-refused',value:0});
    assert.equal((await data('/__fixtures/payments/accounting-state')).receipts.length,count,'a refused refresh sends no receipt');
    console.log('PAY-006: PASS mapped income account, one anonymous sales receipt/payment, lost response recovery, repeated/concurrent retry and revoked token stops sends');
  });
  await probe('PAY-006 erasure keeps reconciliation and export references only in anonymous audit',async()=>{
    const before=await data('/__fixtures/payments/all-rows');
    assert.ok(before.accounting_exports.some(row=>row.booking_id!==id),'an unrelated exported payment is present before erasure');
    const preview=await data('/api/app/privacy/preview',{email:'synthetic-dial-person+200@example.test'});await data('/api/app/privacy/erase',{email:'synthetic-dial-person+200@example.test',confirmation:preview.confirmation,expiresAt:preview.expiresAt});
    const after=await data('/__fixtures/payments/all-rows');
    assert.ok(!JSON.stringify(after).includes('synthetic-dial-person+200'));
    assert.deepEqual(after.bookings,before.bookings.filter(row=>row.id!==id),'other bookings remain unchanged');
    for(const name of ['payment_processor_facts','accounting_exports'])assert.deepEqual(after[name],before[name].filter(row=>row.booking_id!==id),`${name}: unrelated records remain unchanged`);
    for(const name of ['payment_processor_facts','accounting_exports'])assert.ok(!after[name].some(r=>r.booking_id===id));
    assert.ok(after.anonymized_audit.some(r=>r.processor_ref===refund.id));
    console.log('PAY-006: PASS payer erasure removes live facts and exports while anonymous amounts/references survive');
  });
}
