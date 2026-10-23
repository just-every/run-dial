import {combinedApprovalScreens} from './paid-approval-combined-screens.mjs';
import assert from 'node:assert/strict';
import {feeTerms,providerObject} from './paid-approval-support.mjs';
import {paidApprovalScreensSupport} from './paid-approval-screen-support.mjs';
import {setupApprovalScreens} from './paid-approval-setup-screens.mjs';
import {capturedRefundScreens} from './paid-approval-refund-screens.mjs';
/** Parent supplies its current Playwright browser; this module starts no browser, server or watcher. */
export async function runPaidApprovalScreens(options){
  const h=await paidApprovalScreensSupport(options),{data,call,state,capture,manage}=h;
  try{
    const priced=await h.makeEvent('synthetic-pay007-screen-priced',{price:6400}),setup=await h.makeEvent('synthetic-pay007-screen-setup',{terms:feeTerms});
    await capture('approval-settings',`/app/event-types/${priced.id}`,async page=>{const form=page.getByRole('form',{name:'Host approval'});await form.getByRole('button',{name:'Save approval settings'}).waitFor();await form.getByLabel('Require host approval').waitFor();return form;},{session:true});
    const selection=await h.selection(priced);
    await capture('paid-request-details',h.details(selection),async page=>{await page.getByRole('button',{name:'Authorize payment · $64.00 USD',exact:true}).waitFor();await page.getByLabel('Name',{exact:true}).fill('Maya Chen');await page.getByLabel('Email',{exact:true}).fill('synthetic-pay007-maya@example.test');});
    const held=await h.hold(priced,{selection,name:'Maya Chen'});
    await capture('authorization-return',held.step.payment.returnUrl,async page=>{await page.getByRole('heading',{name:'Waiting for Stripe to confirm your authorization.',exact:true}).waitFor();});
    const authorized=await h.authorize(held),approvalUrl=await manage(authorized);assert.ok(approvalUrl);
    await capture('authorization-pending',approvalUrl,async page=>{await page.getByRole('heading',{name:'Waiting for host approval.',exact:true}).waitFor();});
    await capture('owner-authorization','/app/bookings',async page=>{const section=page.getByRole('region',{name:'Approval requests'});await section.getByRole('button',{name:'Approve and capture',exact:true}).waitFor();return section;},{session:true});
    await data(`/api/app/booking-approvals/${authorized.request.id}/decision`,{decision:'approve',reason:'Maya consultation approved'});
    await capture('owner-capture-pending','/app/bookings',async page=>{const section=page.getByRole('region',{name:'Approval requests'});await section.getByText('Waiting for Stripe capture.',{exact:false}).waitFor();return section;},{session:true});
    await capture('invitee-capture-pending',approvalUrl,async page=>{await page.getByRole('heading',{name:'Approval received. Waiting for payment capture.',exact:true}).waitFor();});
    const captured=providerObject(await state(),authorized.intent.id);await h.webhook(h.event('payment_intent.succeeded',captured));
    await capture('approved-confirmation',approvalUrl,async page=>{await page.getByRole('button',{name:'Cancel booking',exact:true}).waitFor();});
    const declined=await h.authorize(await h.hold(priced,{name:'Jordan Miller'})),declineUrl=await manage(declined);
    await data('/__fixtures/payments/control',{name:'stripe-cancel-unavailable',value:1});await data(`/api/app/booking-approvals/${declined.request.id}/decision`,{decision:'decline',reason:'Please choose another time'});
    await capture('owner-void-pending','/app/bookings',async page=>{const section=page.getByRole('region',{name:'Approval requests'});await section.getByText('Waiting for Stripe to release the authorization or detach the saved card.',{exact:true}).waitFor();return section;},{session:true});
    await capture('invitee-void-pending',declineUrl,async page=>{await page.getByRole('heading',{name:'Releasing your payment authorization.',exact:true}).waitFor();});
    await data('/__fixtures/payments/control',{name:'stripe-cancel-unavailable',value:0});await data(`/api/app/booking-approvals/${declined.request.id}/decision`,{decision:'decline'});
    await capture('authorization-declined',declineUrl,async page=>{await page.getByRole('heading',{name:'The host declined this request.',exact:true}).waitFor();});
    const expired=await h.authorize(await h.hold(priced,{name:'Alex Brown'})),expiredUrl=await manage(expired);await call('/__fixtures/approval-expiry',{id:expired.request.id},204);
    await capture('authorization-expired',expiredUrl,async page=>{await page.getByRole('heading',{name:'This request has expired.',exact:true}).waitFor();});
    await capturedRefundScreens(h,priced);await setupApprovalScreens(h,setup);await combinedApprovalScreens(h);await h.finish();return {shots:h.shots};
  }finally{await h.close();}
}
