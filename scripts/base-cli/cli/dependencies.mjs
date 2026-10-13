import {linkApproval,approvalPath} from './dependency-approval.mjs';
import { unlink } from 'node:fs/promises';
import { missing } from './errors.mjs';
import { providerMetadata } from '../modules/dependencies/protocol.mjs';
import { readJson } from '../modules/operator-auth/identity/oidc/network.mjs';

// Only an owner-only, untracked token file is accepted. The token never enters
// setup answers, generated runtime configuration, logs or an archive.
export async function linkDependencies({project,input,origin,store,signal,appSetupToken,fetch:fetcher=globalThis.fetch,clock=Date.now}) {
 const links=[];
 for(const dependency of project.setupManifest?.dependencies??[]) {
  const issuer=input?.[dependency.address];
  if(!issuer) {if(!dependency.optional)throw missing('A required dependency address is missing.');continue;}
  const tokenPath=approvalPath(project,dependency.interface);
  if(!tokenPath) {
   const current=await readJson(fetcher,origin+'/auth/dependencies/status',{timeoutMs:5000}).catch(()=>null);
   if(current?.links?.some(link=>link.interface===dependency.interface && link.issuer===issuer && link.linked===true))continue;
  }
  if(!tokenPath)throw missing('Provider approval is required. Set RER_LINK_TOKEN_FILE to an owner-only, untracked link-token JSON file for this exact origin and callback set.');
  const {path,value}=await linkApproval({project,dependency,issuer,origin,store,clock});
  links.push({dependency,issuer,path,value});
 }
 // Open every initial app approval before the first provider can claim its owner.
 // Hosted runtimes accept their private setup token; no local CLI HMAC is sent.
 if(links.length && appSetupToken) {
  store.addSecrets?.([appSetupToken]);
  for(const {dependency,issuer} of links) {
   try {
    const response=await fetcher(origin+'/auth/dependencies/setup',{method:'POST',redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000),headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({issuer,interface:dependency.interface,token:appSetupToken})});
    // A claimed app still needs its owner's existing fresh email approval.
    const accepted=!response.redirected && (response.status===200 || response.status===409);
    await response.body?.cancel();if(!accepted)throw Error();
   }catch{throw missing('Application setup approval was refused. Approve the link with fresh app-owner email proof before retrying.');}
  }
 }
 for(const {dependency,issuer,path,value} of links) {
  const metadata=await providerMetadata(issuer,fetcher,dependency.interface);
  let result;try {result=await readJson(fetcher,metadata.link.initiate,{timeoutMs:10000},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin,interface:dependency.interface,token:value.token})});}catch{throw missing('Provider link approval was refused or the provider is unavailable.');}
  if(result.linked!==true)throw missing('Provider approval did not complete linking.');
  const status=await readJson(fetcher,origin+'/auth/dependencies/status',{timeoutMs:5000});
  if(!status.links?.some(link=>link.interface===dependency.interface && link.issuer===issuer && link.linked===true))throw missing('The application has not accepted the provider link.');
  await unlink(path);
  store.report('Dependency linked; its one-time approval token was deleted.');
 }
}
