/** Stripe's Customer update and immutable Checkout-email boundary, synthetic only at HTTP. */
export async function stripeCustomerErasure(db:D1Database,url:URL,method:string,form:URLSearchParams){
  const match=/^\/v1\/customers\/([^/]+)$/.exec(url.pathname);
  if(!match||method!=="POST")return undefined;
  const fail=(status:number,code:string)=>Response.json({error:{code,type:"invalid_request_error"}},{status});
  if((await db.prepare("SELECT value FROM wire_controls WHERE name='stripe-anonymize-refused'").first<{value:number}>())?.value)return fail(403,"customer_update_refused");
  const row=await db.prepare("SELECT payload FROM wire_stripe_objects WHERE id=? AND type='customers'").bind(match[1]).first<{payload:string}>();
  if(!row)return fail(404,"resource_missing");
  const fields=["email","name","phone","address","shipping","description","metadata"];
  if([...form.keys()].some(key=>!fields.includes(key))||fields.some(key=>form.get(key)!==""))return fail(400,"parameter_invalid");
  const customer={...JSON.parse(row.payload),email:null,name:null,phone:null,address:null,shipping:null,description:null,metadata:{}};
  await db.prepare("UPDATE wire_stripe_objects SET payload=? WHERE id=?").bind(JSON.stringify(customer),match[1]).run();
  return Response.json(customer);
}
