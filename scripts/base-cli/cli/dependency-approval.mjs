import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {relative,resolve} from 'node:path';
import {contained} from './project.mjs';
import {invalid,missing} from './errors.mjs';
import {CALLBACK} from '../modules/dependencies/protocol.mjs';
export function approvalPath(project,contract) {
 const single=process.env.RER_LINK_TOKEN_FILE,mapping=process.env.RER_LINK_TOKEN_FILES;
 if(single && mapping)throw invalid('Choose one link approval input form.');
 if(!mapping)return single;
 let files;try{files=JSON.parse(mapping);}catch{throw invalid('RER_LINK_TOKEN_FILES must be a JSON map of interfaces to private file paths.');}
 const declared=new Set((project.setupManifest?.dependencies??[]).map(d=>d.interface));
 if(!files || typeof files!=='object' || Array.isArray(files) || Object.entries(files).some(([key,value])=>!declared.has(key)||typeof value!=='string'||!value))throw invalid('Link approval files must name declared interfaces and private file paths.');
 const paths=Object.values(files).map(path=>resolve(project.root,path));
 if(new Set(paths).size!==paths.length)throw invalid('Each interface requires a distinct approval file.');
 return files[contract];
}
export async function linkApproval({project,dependency,issuer,origin,store,clock=Date.now}) {
 const tokenPath=approvalPath(project,dependency.interface);
 if(!tokenPath)throw missing('Provider approval is required. Supply RER_LINK_TOKEN_FILE.');
  const path=await contained(project.root,tokenPath,{privateFile:true});
  let tracked;
  try{tracked=execFileSync('git',['ls-files','--error-unmatch','--',relative(project.root,path)],{cwd:project.root,stdio:['ignore','pipe','ignore']}).length>0;}catch(e){if(e.status!==1)throw invalid('Link token provenance could not be verified in this checkout.');}
  if(tracked)throw invalid('A tracked link token is refused. Create a fresh token in an untracked private file.');
  let value;try{value=JSON.parse(await readFile(path,'utf8'));}catch{throw invalid('Link-token file is invalid.');}
  if(typeof value.token==='string')store?.addSecrets?.([value.token]);
  const callbacks=[origin+CALLBACK,...dependency.paths.map(p=>origin+p)].sort();
  if(typeof value.token!=='string' || !value.token || value.origin!==origin || value.issuer!==issuer || value.interface!==dependency.interface ||
   !Array.isArray(value.callbacks) || JSON.stringify([...value.callbacks].sort())!==JSON.stringify(callbacks) ||
   !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt>clock() || value.expiresAt<=clock() || value.expiresAt-value.issuedAt>3600000)
   throw missing('Link approval must name this exact origin, interface and callback set, be unused, and expire within one hour.');
 return {path,value};
}
