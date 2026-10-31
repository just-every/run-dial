import { useEffect, useState } from "react";
import { Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { credentialScopes, type CredentialScope } from "../scopes";
import { ConsentReview } from "./consent-review";

type Item={id:string;name:string;scopes:string[];expiresAt:string;lastUsedAt?:string|null;revokedAt?:string|null;hostId?:string|null;teamId?:string|null};
const labels:Record<CredentialScope,string>={"bookings:read":"Read bookings","bookings:write":"Write bookings","event-types:manage":"Manage event types","routing:manage":"Manage routing","reports:read":"Read reports","webhooks:manage":"Manage webhooks","workflows:manage":"Manage workflows"};
export async function credentialRequest<T=unknown>(path:string,body?:unknown):Promise<T> {
 const response=await fetch(path,{method:body===undefined?"GET":"POST",headers:{"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(!response.ok){const data=await response.json() as {error?:{message?:string}};throw new Error(data.error?.message??"This credential action could not be completed.");}
 return response.status===204?undefined as T:response.json() as Promise<T>;
}
export function ApiCredentialsCard(){
 const [loaded,setLoaded]=useState(false);
 const [tokens,setTokens]=useState<Item[]>([]),[apps,setApps]=useState<Item[]>([]),[hosts,setHosts]=useState<{id:string;name:string}[]>([]);
 const [name,setName]=useState(""),[kind,setKind]=useState("token"),[hostId,setHostId]=useState(""),[expiry,setExpiry]=useState(""),[redirectUri,setRedirectUri]=useState("");
 const [scopes,setScopes]=useState<CredentialScope[]>([]),[secret,setSecret]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const load=async()=>{
  const [tokenData,appData,hostData]=await Promise.all([credentialRequest<{credentials:Item[]}>("/api/app/api-credentials"),credentialRequest<{applications:Item[]}>("/api/app/oauth-applications"),credentialRequest<{hosts:{id:string;name:string}[]}>("/api/app/api-hosts")]);
  setTokens(tokenData.credentials);setApps(appData.applications);setHosts(hostData.hosts);setLoaded(true);
 };
 useEffect(()=>{void load().catch(reason=>setError(reason.message));},[]);
 const act=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError("");setNotice("");try{await task();await load();}catch(reason){setError(reason instanceof Error?reason.message:"Reload credentials before retrying.");}finally{setBusy(false);}};
 const scopeName=(scope:string)=>labels[scope as CredentialScope]??scope;
 return <Card id="api-credentials" className="min-w-0 p-5 sm:p-6 xl:col-span-2">
  <SectionHeading icon="code" title="API credentials and connected apps" />
  <p className="mt-3 text-sm leading-6 text-soft">Grant only the access an integration needs. A credential cannot open operator pages, export data, erase people or change roles. Revoking access stops its next API request.</p>
  <ConsentReview request={credentialRequest} />
  {error?<p role="alert" className={noticeClassName("error","mt-3")}>{error}</p>:null}
  {notice?<p role="status" className={noticeClassName("success","mt-3")}>{notice}</p>:null}
  {secret?<section aria-label="One-time API secret" className="mt-5 rounded-xl border border-line bg-row p-4"><h3 className="font-semibold">Store this secret now</h3><p className="mt-2 text-sm">It is shown once. Keep it in your application's private secret store.</p><code className="mt-3 block break-all text-sm" data-api-secret>{secret}</code><Button className="mt-3" type="button" variant="secondary" onClick={()=>setSecret(undefined)}>I stored the secret</Button></section>:null}
  <form aria-label="Create API access" className="mt-5 grid gap-4" onSubmit={event=>{event.preventDefault();void act(async()=>{
   const body={name,scopes,expiresAt:new Date(expiry).toISOString(),...(hostId?{hostId}:{})};
   const result=await credentialRequest<{secret?:string;clientSecret?:string;application?:{id:string}}>(kind==="token"?"/api/app/api-credentials":"/api/app/oauth-applications",kind==="token"?body:{...body,grantType:kind,...(kind==="authorization_code"?{redirectUri}:{})});
   setSecret(result.secret??result.clientSecret);setName("");setNotice(kind==="token"?"API token created.":`Application registered. Client ID: ${result.application?.id}`);
  });}}>
   <fieldset disabled={!loaded||busy} className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-semibold">Access type<Select value={kind} onChange={event=>{setKind(event.target.value);setSecret(undefined);}}><option value="token">Personal access token</option><option value="client_credentials">Machine application</option><option value="authorization_code">Delegated application</option></Select></label><label className="grid gap-2 text-sm font-semibold">Integration name<Input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} /></label>
   <label className="grid gap-2 text-sm font-semibold">Host access<Select value={hostId} onChange={event=>setHostId(event.target.value)}><option value="">All workspace hosts</option>{hosts.map(host=><option key={host.id} value={host.id}>{host.name}</option>)}</Select></label><label className="grid gap-2 text-sm font-semibold">Expires at (your local time)<Input type="datetime-local" required value={expiry} onChange={event=>setExpiry(event.target.value)} /></label></div>
   {kind==="authorization_code"?<label className="grid gap-2 text-sm font-semibold">Registered HTTPS callback<Input type="url" required value={redirectUri} onChange={event=>setRedirectUri(event.target.value)} /><span className="font-normal text-soft">The app must use this exact callback and a PKCE proof. Registration alone grants no access.</span></label>:null}
   <fieldset><legend className="text-sm font-semibold">Allowed actions</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{credentialScopes.map(scope=><label key={scope} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={scopes.includes(scope)} onChange={event=>setScopes(current=>event.target.checked?[...current,scope]:current.filter(value=>value!==scope))} />{labels[scope]}</label>)}</div></fieldset>
   <Button type="submit" className="justify-self-start" disabled={!loaded||busy||!scopes.length}>{busy?"Saving…":"Create API access"}</Button></fieldset>
  </form>
  <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Issued access</h3><Button type="button" variant="secondary" disabled={busy} onClick={()=>void act(async()=>{setSecret(undefined);})}>Refresh credentials</Button></div>
  <ul aria-label="Issued API access" className="mt-3 grid gap-3">{[...tokens.map(item=>({...item,type:"token"})),...apps.map(item=>({...item,type:"application"}))].map(item=><li key={item.id} className="min-w-0 rounded-xl bg-row p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words font-semibold">{item.name}</h4><p className="mt-1 break-words text-soft">{item.scopes.map(scopeName).join(", ")}</p><p className="mt-1">{item.hostId?`Host: ${hosts.find(host=>host.id===item.hostId)?.name??"Unavailable host"}`:item.teamId?"One team":"All workspace hosts"}</p><p className="mt-1">Expires {new Date(item.expiresAt).toLocaleString()}</p>{item.type==="token"?<p className="mt-1">Last used: {item.lastUsedAt?new Date(item.lastUsedAt).toLocaleString():"Never used"}</p>:<p className="mt-1 break-all">Client ID: {item.id}</p>}</div><Button type="button" variant="danger" disabled={busy||Boolean(item.revokedAt)} onClick={()=>void act(async()=>{await credentialRequest(`/api/app/${item.type==="token"?"api-credentials":"oauth-applications"}/${item.id}/revoke`,{});setSecret(undefined);setNotice("Access revoked.");})}>{item.revokedAt?"Revoked":"Revoke access"}</Button></div></li>)}</ul>
  {!tokens.length&&!apps.length?<p className="mt-3 text-sm text-soft">No API access has been issued.</p>:null}
 </Card>;
}
