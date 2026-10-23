import assert from 'node:assert/strict';
import {feeTerms,providerObject} from './paid-approval-support.mjs';
export async function combinedApprovalScreens(h){
  const {data,call,state,capture,manage}=h;
  const combined=await h.makeEvent('synthetic-pay007-screen-combined',{price:6400,terms:feeTerms}),selection=await h.selection(combined);
  await capture('combined-request-details',h.details(selection),async page=>{await page.getByRole('button',{name:'Authorize payment · $64.00 USD',exact:true}).waitFor();await page.getByLabel('Name',{exact:true}).fill('Nora Ellis');await page.getByLabel('Email',{exact:true}).fill('synthetic-dial-combined-nora@example.test');await page.locator('.pb-consent input').check();});
  await data('/__fixtures/payments/control',{name:'stripe-setup-response-lost',value:1});
  // Submit the actual invitee form; intercept only the outbound synthetic Checkout edge.
  const invitee=await h.publicContext.newPage();let request;
  try{
    await invitee.route('https://checkout.stripe.com/**',route=>route.fulfill({status:204,body:''}));
    await invitee.goto(new URL(h.details(selection),h.origin).toString());
    await invitee.getByLabel('Name',{exact:true}).fill('Nora Ellis');await invitee.getByLabel('Email',{exact:true}).fill('synthetic-dial-combined-nora@example.test');await invitee.locator('.pb-consent input').check();
    const response=invitee.waitForResponse(value=>new URL(value.url()).pathname===h.base(combined)+'/confirm'&&value.request().method()==='POST');
    await invitee.getByRole('button',{name:'Authorize payment · $64.00 USD',exact:true}).click();
    const submitted=await response;assert.equal(submitted.status(),202);const step=await submitted.json(),payload=submitted.request().postDataJSON(),session=JSON.parse((await state()).wire_stripe_sessions.find(row=>JSON.parse(row.payload).url===step.payment.checkoutUrl).payload);
    request={event:combined,selected:selection,payload,session,step,returnToken:new URL(step.payment.returnUrl).searchParams.get('return')};
  }finally{await invitee.close();}
  const held=await h.authorize(request),url=await manage(held);assert.equal(JSON.parse(held.request.payment_json).state,'setup_pending');
  await capture('combined-consent-pending',url,async page=>{await page.getByRole('heading',{name:'Completing your saved-card consent.',exact:true}).waitFor();});
  await capture('owner-combined-consent','/app/bookings',async page=>{const region=page.getByRole('region',{name:'Approval requests'});await region.getByText('Completing the saved-card consent with Stripe.',{exact:false}).waitFor();return region;},{session:true});
  await data('/__fixtures/payments/control',{name:'stripe-setup-response-lost',value:0});await h.webhook(h.event('payment_intent.amount_capturable_updated',held.intent));
  await capture('combined-pending',url,async page=>{await page.getByRole('heading',{name:'Waiting for host approval.',exact:true}).waitFor();await page.getByText('Your consent is bound to the fees shown',{exact:false}).waitFor();});
  await capture('owner-combined-ready','/app/bookings',async page=>{const region=page.getByRole('region',{name:'Approval requests'});await region.getByText('Card saved for the stated fees.',{exact:false}).waitFor();return region;},{session:true});
  const host=await h.owner.newPage();
  try{
    await host.goto(new URL('/app/bookings',h.origin).toString());const card=host.getByRole('region',{name:'Approval requests'}).getByRole('heading',{name:'Nora Ellis',exact:true}).locator('..');
    await card.getByLabel('Decision note (optional)').fill('Reviewed the consultation and consented terms');
    const response=host.waitForResponse(value=>new URL(value.url()).pathname===`/api/app/booking-approvals/${held.request.id}/decision`&&value.request().method()==='POST');
    await card.getByRole('button',{name:'Approve and capture',exact:true}).click();assert.ok([200,202].includes((await response).status()));await card.getByText('Waiting for Stripe capture.',{exact:false}).waitFor();
  }finally{await host.close();}
  await capture('owner-combined-capture-pending','/app/bookings',async page=>{const region=page.getByRole('region',{name:'Approval requests'});await region.getByText('Waiting for Stripe capture.',{exact:false}).waitFor();return region;},{session:true});
  await capture('combined-capture-pending',url,async page=>{await page.getByRole('heading',{name:'Approval received. Waiting for payment capture.',exact:true}).waitFor();});
  await h.webhook(h.event('payment_intent.succeeded',providerObject(await state(),held.intent.id)));
  await capture('combined-approved',url,async page=>{await page.getByRole('button',{name:'Cancel booking',exact:true}).waitFor();});
  for(const outcome of ['declined','expired']){
    const request=await h.authorize(await h.hold(combined,{name:outcome==='declined'?'Ravi Shah':'Alex Brown'})),status=await manage(request);
    if(outcome==='declined')await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'decline'});else await call('/__fixtures/approval-expiry',{id:request.request.id},204);
    await capture(`combined-${outcome}`,status,async page=>{await page.getByText('The saved card has been detached from this request.',{exact:true}).waitFor();});
  }
  const deposit=await h.makeEvent('synthetic-pay007-screen-combined-deposit',{price:10000,terms:{...feeTerms,deposit:{kind:'fixed',amountCents:2500}}});
  await capture('combined-deposit-request',h.details(await h.selection(deposit)),async page=>{await page.getByRole('button',{name:'Authorize payment · $25.00 USD',exact:true}).waitFor();await page.locator('.pb-consent input').check();});
}
