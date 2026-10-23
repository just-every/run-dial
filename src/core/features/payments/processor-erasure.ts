import { ProcessorRequestsRepository, type ProcessorRequest } from "../erasure";
import type { MoneyRefusal } from "./money-service";
import { StripeApi, StripeApiError } from "./stripe-api";

type Live = () => Promise<{api:StripeApi;accountId:string}|{refusal:MoneyRefusal}>;
/** The retained request contains only the references required to retry after local erasure. */
export class ProcessorErasure {
  readonly requests: ProcessorRequestsRepository;
  constructor(private readonly db:D1Database,private readonly live:Live){this.requests=new ProcessorRequestsRepository(db);}
  async prepare(email:string,receiptId:string,actorId:string){await this.requests.prepare(email,receiptId,actorId);await this.retry(receiptId);}
  async retry(receiptId:string){for(const request of await this.requests.list(receiptId))if(["saved_card_detach","stripe_customer_anonymize"].includes(request.kind))await this.execute(request);}
  async customer(email:string,accountId:string,processorRef:string){const receiptId=await this.requests.receiptForEmail(email);if(receiptId)await this.execute(await this.requests.ensure(receiptId,{kind:"stripe_customer_anonymize",accountId,processorRef}));}
  async detach(email:string,accountId:string,processorRef:string){
    const receiptId=await this.requests.receiptForEmail(email);
    if(!receiptId)throw Error("processor_erasure_receipt_missing");
    const item=await this.requests.ensure(receiptId,{kind:"saved_card_detach",accountId,processorRef});await this.execute(item);
    return (await this.requests.list(receiptId)).find(row=>row.id===item.id)!.state==="completed";
  }
  async detachBooking(bookingId:string,ordinary:()=>Promise<"detached"|"not_saved"|MoneyRefusal|"stripe_failed">){
    const row=await this.db.prepare(`SELECT b.invitee_email_folded AS email,c.account_id AS accountId,c.stripe_payment_method_id AS ref
      FROM bookings b JOIN booking_card_consents c ON c.booking_id=b.id WHERE b.id=? AND c.stripe_payment_method_id IS NOT NULL`).bind(bookingId).first<{email:string;accountId:string;ref:string}>();
    if(!row||!await this.requests.receiptForEmail(row.email))return ordinary();
    return await this.detach(row.email,row.accountId,row.ref)?"detached" as const:"stripe_failed" as const;
  }
  async fact(email:string,kind:"payment_authorization_void"|"payment_refund",accountId:string,processorRef:string,amountCents:number){
    const receiptId=await this.requests.receiptForEmail(email);if(receiptId)await this.requests.ensure(receiptId,{kind,accountId,processorRef,amountCents,state:"completed",requested:true});
  }
  private async execute(item:ProcessorRequest){
    if(item.state!=="pending"||!await this.requests.claim(item.id))return;
    const connection=await this.live();
    if("refusal" in connection||connection.accountId!==item.accountId){await this.requests.finish(item.id,"pending","refusal" in connection?connection.refusal:"stripe_account_changed");return;}
    await this.requests.requested(item.id);
    try{
      if(item.kind==="saved_card_detach")await connection.api.detachPaymentMethod(item.accountId,item.processorRef,`dial-erasure-${item.id}`);
      else await connection.api.anonymizeCustomer(item.accountId,item.processorRef,`dial-erasure-${item.id}`);
      await this.requests.finish(item.id,"completed",null);
    }catch(error){
      const definite=error instanceof StripeApiError&&error.status>=400&&error.status<500&&![409,429].includes(error.status);
      if(item.kind==="saved_card_detach"&&error instanceof StripeApiError&&["resource_missing","payment_method_unexpected_state"].includes(error.code))await this.requests.finish(item.id,"completed","already_detached_or_absent");
      else await this.requests.finish(item.id,definite?"failed":"pending",error instanceof StripeApiError?error.code:"stripe_unreachable");
    }
  }
}
