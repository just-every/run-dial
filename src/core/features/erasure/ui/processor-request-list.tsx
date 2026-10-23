type Item = {id?:string;kind:string;processorRef:string;state:string;reason:string|null;requested:boolean};
const labels:Record<string,string> = {calendar_event_cancel:"Calendar event cancellation",saved_card_detach:"Saved-card detach",stripe_customer_anonymize:"Stripe Customer anonymize",stripe_checkout_email:"Stripe Checkout email",payment_authorization_void:"Payment authorization void",payment_refund:"Payment refund"};
const reasons:Record<string,string> = {checkout_customer_email_not_editable_no_erasure_api:"Stripe cannot edit or erase the email on an existing Checkout Session. No email-erasure request was sent.",awaiting_erasure_confirmation:"Waiting for your confirmation."};

export function ProcessorRequestList({items}:{items:Item[]}){
  if(!items.length)return <p className="mt-3 text-sm text-soft">No external processor requests are known for these records.</p>;
  return <ul aria-label="Processor erasure requests" className="mt-3 grid gap-3 text-sm">
    {items.map(item=><li key={item.id??`${item.kind}:${item.processorRef}`} className="min-w-0 rounded-lg border border-line p-3">
      <p className="font-semibold">{labels[item.kind]??item.kind}: {item.state}.</p>
      <p className="mt-1 break-all text-soft">Reference: {item.processorRef}</p>
      {item.reason?<p className="mt-1 text-soft">{reasons[item.reason]??`Reason: ${item.reason.replaceAll("_"," ")}.`}</p>:null}
    </li>)}
  </ul>;
}
