export async function capturedRefundScreens(h,priced){
  const {data,capture}=h,request=await h.authorize(await h.hold(priced,{name:'Sam Rivera'})),url=await h.manage(request);
  await data(`/api/app/booking-approvals/${request.request.id}/decision`,{decision:'approve'});
  await data('/__fixtures/payments/control',{name:'stripe-refund-unavailable',value:1});
  await data(`/api/app/booking-approvals/${request.request.id}/cancel`,{reason:'Host schedule changed after capture'});
  await capture('owner-refund-pending','/app/bookings',async page=>{const region=page.getByRole('region',{name:'Approval requests'});await region.getByText('Waiting for Stripe to refund the captured payment.',{exact:true}).waitFor();return region;},{session:true});
  await capture('invitee-refund-pending',url,async page=>{await page.getByRole('heading',{name:'Refunding your captured payment.',exact:true}).waitFor();});
  await data('/__fixtures/payments/control',{name:'stripe-refund-unavailable',value:0});await data(`/api/app/booking-approvals/${request.request.id}/cancel`,{});
  await capture('captured-payment-refunded',url,async page=>{await page.getByText('Refunded $64.00 USD in full.',{exact:false}).waitFor();});
}
