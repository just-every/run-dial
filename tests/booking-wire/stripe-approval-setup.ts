/** Stripe's standalone SetupIntent edge: confirmation on the already attached Checkout card. */
export async function stripeApprovalSetup(db:D1Database,url:URL,method:string,form:URLSearchParams) {
  const failure=(code:string)=>Response.json({error:{code,type:"invalid_request_error"}},{status:400});
  if(url.pathname==="/v1/setup_intents" && method==="POST") {
    if(form.has("payment_method_types[0]") || form.get("confirm")!=="true" || form.get("usage")!=="off_session" || form.get("automatic_payment_methods[enabled]")!=="true" || form.get("automatic_payment_methods[allow_redirects]")!=="never" || form.get("allowed_payment_method_types[0]")!=="card" || form.get("allowed_payment_method_types[1]")!=="link" || !form.get("metadata[dial_hold_id]") || !form.get("metadata[dial_consent_version]"))return failure("parameter_invalid");
    const card=await db.prepare("SELECT payload FROM wire_stripe_objects WHERE id=?").bind(form.get("payment_method")).first<{payload:string}>();
    if(!card || JSON.parse(card.payload).customer!==form.get("customer"))return failure("payment_method_unexpected_state");
    const control=await db.prepare("SELECT value FROM wire_controls WHERE name='stripe-setup-requires-action'").first<{value:number}>();
    const setup={id:`stripe-setup~${crypto.randomUUID()}`,object:"setup_intent",status:control?.value?"requires_action":"succeeded",customer:form.get("customer"),payment_method:form.get("payment_method"),usage:"off_session",metadata:Object.fromEntries([...form].filter(([key])=>key.startsWith("metadata[")).map(([key,value])=>[key.slice(9,-1),value]))};
    await db.prepare("INSERT INTO wire_stripe_objects(id,type,payload) VALUES(?,'setup_intents',?)").bind(setup.id,JSON.stringify(setup)).run();
    return Response.json(setup);
  }
  const cancel=/^\/v1\/setup_intents\/([^/]+)\/cancel$/.exec(url.pathname);
  if(cancel && method==="POST") {
    const row=await db.prepare("SELECT payload FROM wire_stripe_objects WHERE id=? AND type='setup_intents'").bind(cancel[1]).first<{payload:string}>();
    if(!row)return failure("resource_missing");
    const setup=JSON.parse(row.payload);
    if(!["requires_action","requires_confirmation","requires_payment_method"].includes(setup.status)||form.get("cancellation_reason")!=="abandoned")return failure("setup_intent_unexpected_state");
    setup.status="canceled";
    await db.prepare("UPDATE wire_stripe_objects SET payload=? WHERE id=?").bind(JSON.stringify(setup),cancel[1]).run();
    return Response.json(setup);
  }
  return undefined;
}
