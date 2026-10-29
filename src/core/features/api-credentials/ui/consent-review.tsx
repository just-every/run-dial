import { useEffect, useState } from "react";
import { Button, buttonClassName } from "../../../app/ui/primitives";

type Review={application:{name:string;redirectUri:string;expiresAt:string;hostId:string|null;teamId:string|null};scopes:string[]};
export function ConsentReview({request}:{request:(path:string,body?:unknown)=>Promise<unknown>}){
 const [parameters,setParameters]=useState<Record<string,string>>(),[review,setReview]=useState<Review>(),[error,setError]=useState(""),[busy,setBusy]=useState(false),[destination,setDestination]=useState<string>();
 const [grants,setGrants]=useState<{id:string;name:string;revokedAt:string|null}[]>([]);
 const load=async()=>setGrants((await request("/api/app/oauth/grants") as {grants:typeof grants}).grants);
 useEffect(()=>{
  void load().catch(reason=>setError(reason.message));
  const search=new URLSearchParams(window.location.search);
  if(!search.has("client_id"))return;
  const input=Object.fromEntries(["client_id","redirect_uri","response_type","scope","state","code_challenge","code_challenge_method"].map(key=>[key,search.get(key)??""]));
  setParameters(input);
  void request("/api/app/oauth/authorize?"+new URLSearchParams(input)).then(value=>setReview(value as Review)).catch(reason=>setError(reason.message));
 },[]);
 async function decide(approve:boolean){
  if(busy||!parameters)return;setBusy(true);setError("");
  try{const result=await request("/api/app/oauth/authorize",{...parameters,approve}) as {redirectUrl:string};setReview(undefined);setDestination(result.redirectUrl);await load();}
  catch(reason){setError(reason instanceof Error?reason.message:"Review this connection again.");}finally{setBusy(false);}
 }
 return <div className="mt-5 text-sm">
  {error?<p role="alert">{error}</p>:null}
  {review?<section aria-label="Review app access" className="rounded-xl border border-line p-4"><h3 className="text-base font-semibold">Connect {review.application.name}?</h3><p className="mt-2">This app requests: {review.scopes.join(", ")}.</p><p className="mt-2">Access is limited to {review.application.hostId?"the registered host":review.application.teamId?"the registered team":"this workspace"}, until {new Date(review.application.expiresAt).toLocaleString()}.</p><p className="mt-2 break-all">Return to {review.application.redirectUri}</p><p className="mt-2">Approving creates a revocable grant. Declining shares no booking data.</p><div className="mt-4 flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={()=>void decide(true)}>Approve app access</Button><Button type="button" variant="secondary" disabled={busy} onClick={()=>void decide(false)}>Decline app access</Button></div></section>:null}
  {destination?<p role="status" className="mt-3"><a className={buttonClassName("secondary")} href={destination} rel="noreferrer">Return to application</a></p>:null}
  {grants.some(grant=>!grant.revokedAt)?<section aria-label="Connected applications" className="mt-4"><h3 className="font-semibold">Connected applications</h3><ul className="mt-3 grid gap-2">{grants.filter(grant=>!grant.revokedAt).map(grant=><li key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-row p-3"><span>{grant.name}</span><Button type="button" variant="danger" disabled={busy} onClick={()=>{if(busy)return;setBusy(true);void request(`/api/app/oauth/grants/${grant.id}/revoke`,{}).then(load).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}>Disconnect app</Button></li>)}</ul></section>:null}
 </div>;
}
