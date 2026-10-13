import { appFetch } from './app-fetch.mjs';
// Setup opens app-local approvals before native bootstrap. Existing owners must
// prove their email afresh through the local outbox, just like owner controls.
export async function approveSetupDependencies(context, post, messages) {
 const selected=(context.manifest?.dependencies??[]).filter(d=>context.input[d.address]);
 if(!selected.length)return;
 const failure=()=>Error('Application dependency approval failed. Complete fresh app-owner approval before linking.');
 let cookie;
 const current=await appFetch(new URL('/auth/dependencies/status',context.origin),{signal:context.signal}).then(response=>response.ok?response.json():null);
 const files=process.env.RER_LINK_TOKEN_FILES?JSON.parse(process.env.RER_LINK_TOKEN_FILES):{};
 for(const dependency of selected) {
  const body={interface:dependency.interface,issuer:context.input[dependency.address]};
  if(!process.env.RER_LINK_TOKEN_FILE && !files[dependency.interface] && current?.links?.some(link=>link.interface===body.interface && link.issuer===body.issuer && link.linked))continue;
  const setup=await post(context,'/auth/dependencies/setup',{...body,token:context.vars[context.ownerClaim?.tokenField??'SETUP_TOKEN']});
  if(setup.ok){await setup.body?.cancel();continue;}
  if(setup.status!==409)throw failure();
  await setup.body?.cancel();
  if(!cookie) {
   const email=context.vars[context.ownerClaim?.emailField??'OWNER_EMAIL']??context.input[context.ownerClaim?.emailField??'OWNER_EMAIL'];
   const path='/__dev/outbox',before=new Set(await messages(context,path,email,true));
   const sent=await post(context,'/auth/magic-link',{email});if(sent.status!==202)throw failure();await sent.body?.cancel();
   let id;
   for(let attempt=0;attempt<50 && !id;attempt++) {id=(await messages(context,path,email)).find(value=>!before.has(value));if(!id)await new Promise(resolve=>setTimeout(resolve,200));}
   if(!id)throw failure();
   const response=await appFetch(new URL(path+'?message='+encodeURIComponent(id),context.origin),{signal:context.signal,headers:context.devKey?{'x-rer-dev-key':context.devKey}:{}});
   if(!response.ok)throw failure();
   const html=await response.text(),href=/<a\b[^>]*class="open"[^>]*href="([^"]+)"/.exec(html)?.[1];
   if(!href)throw failure();
   const url=new URL(href.replaceAll('&amp;','&'));if(url.origin!==context.origin || url.pathname!=='/auth/confirm')throw failure();
   const confirmed=await post(context,'/auth/confirm',{token:url.searchParams.get('token')});
   if(confirmed.status!==303)throw failure();cookie=confirmed.headers.get('set-cookie')?.split(';')[0];await confirmed.body?.cancel();
   if(!cookie)throw failure();context.store.addSecrets?.([cookie]);
  }
  const approved=await appFetch(new URL('/auth/dependencies/relink',context.origin),{method:'POST',redirect:'manual',signal:context.signal,headers:{Origin:context.origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  if(!approved.ok)throw failure();await approved.body?.cancel();
 }
}
