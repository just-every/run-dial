import { useState } from 'react';
import { workspaceFetch } from '../../../app/workspace-reads';
import { Button, Input, Select } from '../../../app/ui/primitives';

export function SchedulerSource({disabled,onCapture}:{disabled:boolean;onCapture:(file:File)=>void}){
 const [provider,setProvider]=useState('calcom'),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function connect(){
  setBusy(true);setError('');
  const credential=token;setToken('');
  try{
   const response=await workspaceFetch(`/api/app/move-in/connections/${provider}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:credential})});
   const capture=await response.json() as {error?:{message?:string}};
   if(!response.ok)throw new Error(capture.error?.message??'The scheduler capture could not be downloaded.');
   onCapture(new File([JSON.stringify(capture)],`${provider}-capture.json`,{type:'application/json'}));
  }catch(e){setError(e instanceof Error?e.message:'The scheduler capture could not be downloaded.');}finally{setBusy(false);}
 }
 return <details className="rounded-2xl bg-row p-4 text-sm"><summary className="cursor-pointer font-semibold">Capture from a scheduler API</summary><div className="mt-4 space-y-3">
  <p>Download a read-only snapshot, then preview it below. Your access token is used for this request and is never saved. Nothing in your source account changes.</p>
  <label className="block font-semibold">Source scheduler<Select className="mt-2 block" value={provider} disabled={disabled||busy} onChange={e=>{setProvider(e.target.value);setToken('');}}><option value="calcom">Cal.com</option><option value="savvycal">SavvyCal</option></Select></label>
  <label className="block font-semibold">Scheduler access token<Input className="mt-2 block" type="password" autoComplete="off" value={token} disabled={disabled||busy} onChange={e=>setToken(e.target.value)}/></label>
  <Button disabled={disabled||busy||!token} onClick={()=>void connect()}>{busy?'Capturing…':'Capture source data'}</Button>
  {error?<p role="alert" className="break-words text-danger">{error}</p>:null}
 </div></details>;
}
