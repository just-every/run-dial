export async function setupApprovalScreens(h,setup){
  const {capture,data,call}=h,selection=await h.selection(setup);
  await capture('saved-card-request-details',h.details(selection),async page=>{await page.getByRole('button',{name:'Continue to save your card',exact:true}).waitFor();await page.getByLabel('Name',{exact:true}).fill('Leah Patel');await page.getByLabel('Email',{exact:true}).fill('synthetic-pay007-leah@example.test');await page.locator('.pb-consent input').check();});
  const saved=await h.authorize(await h.hold(setup,{selection,name:'Leah Patel'})),url=await h.manage(saved);
  await capture('saved-card-pending',url,async page=>{await page.getByRole('heading',{name:'Waiting for host approval.',exact:true}).waitFor();await page.getByText('Your card is saved with Stripe',{exact:false}).waitFor();});
  await capture('owner-saved-card','/app/bookings',async page=>{const section=page.getByRole('region',{name:'Approval requests'});await section.getByText('Card saved with consent',{exact:false}).waitFor();return section;},{session:true});
  await data(`/api/app/booking-approvals/${saved.request.id}/decision`,{decision:'approve'});
  await capture('saved-card-approved',url,async page=>{await page.getByRole('button',{name:'Cancel booking',exact:true}).waitFor();});
  for(const outcome of ['declined','expired']){
    const request=await h.authorize(await h.hold(setup,{name:outcome==='declined'?'Nora Ellis':'Ravi Shah'})),manage=await h.manage(request);
    if(outcome==='declined')await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'decline'});else await call('/__fixtures/approval-expiry',{id:request.request.id},204);
    await capture('saved-card-'+outcome,manage,async page=>{await page.getByText('Your saved card has been detached from this request.',{exact:false}).waitFor();});
  }
  const deposit=await h.makeEvent('synthetic-pay007-screen-deposit',{price:10000,terms:{deposit:{kind:'fixed',amountCents:2500},balanceDueHours:24,freeWindowHours:null,lateCancelFeeCents:0,noShowFeeCents:0}}),depositSelection=await h.selection(deposit);
  await capture('deposit-authorization-details',h.details(depositSelection),async page=>{await page.getByRole('button',{name:'Authorize payment · $25.00 USD',exact:true}).waitFor();await page.getByText('balance after approval and capture.',{exact:false}).waitFor();});
}
