import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { formatUsd } from "../../../shared/event-price";
import { accountingFailure, accountingFeedback, actionFeedback, statusSchema, rowsSchema, accountsSchema, exportsSchema, acknowledgementSchema, type Feedback } from "./accounting-feedback";
type Status={state:string;configured:boolean;incomeAccountId:string|null;reason:string|null};
type Row={bookingId:string;eventTitle:string;inviteeName:string;processorRef:string|null;amountCents:number;kind:string;currency:string;status:string;disagreement:number;exported:boolean};
export function AccountingCard(){
  const [status,setStatus]=useState<Status>(),[rows,setRows]=useState<Row[]>([]),[accounts,setAccounts]=useState<Array<{id:string;name:string}>>([]),[account,setAccount]=useState(''),[error,setError]=useState<Feedback|null>(null),[notice,setNotice]=useState(''),[working,setWorking]=useState(false);
  const actionFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const source=actionFocus.current;
    if(working||!source)return;
    actionFocus.current=null;
    if(document.activeElement!==document.body&&document.activeElement!==source)return;
    const card=document.getElementById('payment-reconciliation');
    const target=source.isConnected&&!source.matches(':disabled')?source:card?.querySelector<HTMLElement>('button:not(:disabled)')??card?.querySelector<HTMLElement>('a[href]');
    target?.focus({preventScroll:true});
  },[working]);
  const load=async()=>{
    const responses=await Promise.all([fetch('/api/app/payments/accounting'),fetch('/api/app/payments/reconciliation')]);
    for(const response of responses)if(!response.ok)throw await accountingFailure(response);
    const nextStatus=statusSchema.parse(await responses[0].json()),nextRows=rowsSchema.parse(await responses[1].json());
    setStatus(nextStatus);setRows(nextRows.rows);
  };
  useEffect(()=>{void load().catch(()=>setError({message:'Payments could not be loaded; reload Settings to try again.',guidance:'Sign in if required.'}));},[]);
  async function act(path:string,method='POST',body?:unknown){
    const action=path==='/export'?'export':path==='/mapping'?'mapping':'accounting';
    actionFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setWorking(true);setError(null);setNotice('');
    try{
      const response=await fetch('/api/app/payments/accounting'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok)throw await accountingFailure(response,action);
      const value:unknown=await response.json();
      if(path==='/accounts')setAccounts(accountsSchema.parse(value).accounts);
      else {
        const saved=path==='/export'?`${exportsSchema.parse(value).exports.filter(r=>r.state==='exported').length} payments exported to QuickBooks Online.`:(statusSchema.parse(value),'Accounting settings saved.');
        setNotice(saved);await load();
      }
    }catch(cause){setError(actionFeedback(cause,action));await load();}finally{setWorking(false);}
  }
  async function acknowledge(row:Row){
    actionFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setWorking(true);setError(null);
    try{
      const response=await fetch(`/api/app/bookings/${row.bookingId}/reconciliation/acknowledge`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processorRef:row.processorRef})});
      if(!response.ok)throw await accountingFailure(response,'acknowledgement');
      acknowledgementSchema.parse(await response.json());
      await load();setNotice('Reconciled refund acknowledged.');
    }catch(cause){setError(actionFeedback(cause,'acknowledgement'));}finally{setWorking(false);}
  }
  const reason=status?.reason?accountingFeedback(status.reason,'accounting',true):null;
  const reasonText=reason?(error?[reason.message]:[reason.message,reason.guidance]).filter(text=>text!==error?.message&&text!==error?.guidance).join(' '):'';
  const setupLine=accountingFeedback('accounting_not_configured').guidance;
  return <Card id="payment-reconciliation" className="min-w-0 p-5 sm:p-6 xl:col-span-2"><SectionHeading icon="calendar" title="Payments and accounting" action={<Badge tone={status?.state==='connected'?'success':'warning'}>{status?.state??'Loading'}</Badge>}/><p className="mt-3 text-sm text-soft">Charges, refunds, processor fees and disputes, with Stripe references. Reconciliation records processor facts and never moves money.</p>
    {reasonText?<p className="mt-3 text-sm text-ink">{reasonText}</p>:null}
    {error?<p role="alert" className={noticeClassName('error','mt-3')}>{error.message} {error.guidance}{error.signIn?<a className="ml-1 font-semibold underline" href="/signin?next=%2Fapp%2Fsettings">Sign in</a>:null}</p>:null}{notice?<p role="status" className={noticeClassName('success','mt-3')}>{notice}</p>:null}
    <div className="mt-5 flex flex-wrap gap-3"><a className="font-semibold underline" href="/api/app/payments/export.csv">Download payments CSV</a>{status?.state!=='connected'?<Button disabled={!status?.configured} onClick={()=>window.location.assign('/api/app/payments/accounting/oauth/start')}>{status?.state==='unhealthy'?'Reconnect QuickBooks Online':'Connect QuickBooks Online'}</Button>:<><Button variant="secondary" disabled={working} onClick={()=>void act('/accounts','GET')}>Choose income account</Button><Button disabled={working||!status.incomeAccountId} onClick={()=>void act('/export')}>Export to QuickBooks Online</Button><Button variant="quiet" disabled={working} onClick={()=>void act('','DELETE')}>Disconnect accounting</Button></>}</div>
    {!status?.configured&&status&&setupLine!==error?.message&&setupLine!==error?.guidance?<p className="mt-3 text-sm text-soft">{setupLine}</p>:null}
    {accounts.length?<form aria-label="Accounting income account" className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void act('/mapping','PUT',{accountId:account});}}><div className="grid gap-2 text-sm font-semibold"><label htmlFor="accounting-income-account">Income account</label><Select id="accounting-income-account" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Choose income account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></div><Button className="self-end" disabled={!account||working}>Save income account</Button></form>:null}
    {rows.length?<ol aria-label="Payment reconciliation" className="mt-5 grid min-w-0 gap-3">{rows.map((row,index)=><li key={index} className="min-w-0 rounded-xl bg-row p-4 text-sm"><p className="flex flex-wrap gap-2 font-semibold text-ink"><a className="underline" href={`/app/bookings?query=${encodeURIComponent(row.inviteeName)}`}>{row.inviteeName} · {row.eventTitle}</a>{row.disagreement?<Badge tone="warning">Needs attention</Badge>:null}{row.exported?<Badge tone="success">Exported</Badge>:null}</p><p className="mt-2">{row.kind} · {row.currency==='usd'?formatUsd(row.amountCents):`${(row.amountCents/100).toFixed(2)} ${row.currency.toUpperCase()}`} · {row.status}</p><p className="mt-1 break-all text-muted">Stripe {row.processorRef}</p>{row.disagreement&&row.kind==='refund'?<Button className="mt-3" variant="secondary" disabled={working} onClick={()=>void acknowledge(row)}>Acknowledge refund</Button>:null}</li>)}</ol>:<p className="mt-5 text-sm text-soft">No payments recorded.</p>}
  </Card>;
}
