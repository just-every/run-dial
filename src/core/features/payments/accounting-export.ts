import {createId,nowIso} from "../../shared/ids";
import {AccountingFailure,type AccountingConnection} from "./accounting-types";
/** Frozen anonymous receipt payloads and provider request ids survive ambiguous responses. */
export async function exportAccounting(db:D1Database,row:AccountingConnection,request:(path:string,body?:unknown,id?:string)=>Promise<Record<string,unknown>>,query:(sql:string)=>Promise<Record<string,unknown>>){
  if(!row.item_id||!row.income_account_id)throw new AccountingFailure('income_account_required',409);
    const preferences=await request('preferences');
    if(!(preferences.Preferences as {SalesFormsPrefs?:{CustomTxnNumbers?:boolean}})?.SalesFormsPrefs?.CustomTxnNumbers)throw new AccountingFailure('accounting_custom_transaction_numbers_required',409);
    if((preferences.Preferences as {CurrencyPrefs?:{HomeCurrency?:{value?:string}}})?.CurrencyPrefs?.HomeCurrency?.value!=='USD')throw new AccountingFailure('accounting_usd_company_required',409);
    const payments=(await db.prepare(`SELECT booking_id, payment_intent_id AS ref,amount_cents,tax_cents FROM booking_payments WHERE payment_intent_id IS NOT NULL UNION ALL SELECT booking_id,processor_ref,amount_cents,tax_cents FROM payment_movements WHERE status='succeeded' AND kind IN ('balance','invoice','late_cancel_fee','no_show_fee') AND processor_ref IS NOT NULL`).all<{booking_id:string;ref:string;amount_cents:number;tax_cents:number}>()).results;
    if(payments.some(p=>p.tax_cents>0))throw new AccountingFailure('accounting_tax_mapping_required',409);
    for(const payment of payments){const now=nowIso();const requestId=createId(),documentRef=requestId.slice(-21),connectionId=`quickbooks:${row.realm_id}`;
      const payload={DocNumber:documentRef,PrivateNote:`Dial payment ${payment.ref}`,Line:[{Amount:payment.amount_cents/100,DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{value:row.item_id},Qty:1,UnitPrice:payment.amount_cents/100}}]};await db.prepare("INSERT INTO accounting_exports(id,booking_id,connection_id,payment_ref,amount_cents,request_id,document_ref,payload_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(connection_id,payment_ref) DO NOTHING").bind(createId(),payment.booking_id,connectionId,payment.ref,payment.amount_cents,requestId,documentRef,JSON.stringify(payload),now,now).run();const entry=await db.prepare("SELECT * FROM accounting_exports WHERE connection_id=? AND payment_ref=?").bind(connectionId,payment.ref).first<{id:string;request_id:string;document_ref:string;payload_json:string;state:string}>();if(!entry||entry.state==='exported')continue;
      // A durable request id is also the DocNumber: look up after response loss before sending again.
      const found=await query(`select * from SalesReceipt where DocNumber = '${entry.document_ref}'`);const candidates=(found.QueryResponse as {SalesReceipt?:Array<{Id:string;DocNumber:string;PrivateNote:string;Line:unknown[]}>})?.SalesReceipt??[];if(candidates.length>1||candidates.some(candidate=>candidate.DocNumber!==entry.document_ref||candidate.PrivateNote!==payload.PrivateNote||!matchingLines(candidate.Line,(JSON.parse(entry.payload_json) as {Line:unknown[]}).Line)))throw new AccountingFailure('accounting_recovery_mismatch',409);let receipt=candidates[0] as {Id:string}|undefined;
      if(!receipt)receipt=(await request('salesreceipt',JSON.parse(entry.payload_json),entry.request_id)).SalesReceipt as {Id:string}|undefined;
      if(!receipt?.Id)throw new AccountingFailure('accounting_receipt_missing');await db.prepare("UPDATE accounting_exports SET state='exported',receipt_id=?,updated_at=? WHERE id=?").bind(receipt.Id,nowIso(),entry.id).run();
    }return (await db.prepare('SELECT booking_id AS bookingId,payment_ref AS paymentRef,receipt_id AS receiptId,state FROM accounting_exports ORDER BY created_at').all()).results;
}

function matchingLines(actual:unknown[],expected:unknown[]){
  if(!Array.isArray(actual)||actual.length!==expected.length)return false;
  const facts=(line:unknown)=>{const r=line as {Amount?:unknown;DetailType?:unknown;SalesItemLineDetail?:{ItemRef?:{value?:unknown};Qty?:unknown;UnitPrice?:unknown}};return [r.Amount,r.DetailType,r.SalesItemLineDetail?.ItemRef?.value,r.SalesItemLineDetail?.Qty,r.SalesItemLineDetail?.UnitPrice];};
  return actual.every((line,index)=>JSON.stringify(facts(line))===JSON.stringify(facts(expected[index])));
}
