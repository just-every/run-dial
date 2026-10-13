import {linkApproval,approvalPath} from './dependency-approval.mjs';
import { localDependencyLinks } from './dependency-doctor.mjs';
import { readJson } from '../modules/operator-auth/identity/oidc/network.mjs';
import { originOf } from '../modules/dependencies/protocol.mjs';
import { invalid, missing } from './errors.mjs';
import { shared } from './shared.mjs';

// Read the selected graph before setup writes anything. Optional selected edges
// participate just like required edges; disconnected declarations do not.
export async function dependencyInputs({project,input,origin,fetch:fetcher=globalThis.fetch}) {
 const declarations=project.setupManifest?.dependencies??[],selected=declarations.filter(d=>input[d.address]);
 if(declarations.some(d=>!d.optional&&!input[d.address]))throw missing('A required dependency address is missing.');
 if(!selected.length)return;
 const existing=await localDependencyLinks(project.root);
 const pending=selected.filter(d=>approvalPath(project,d.interface) || !existing.some(link=>link.interface===d.interface && link.issuer===input[d.address] && !link.needs_relink));
 if(!pending.length)return;
 const nodes=new Map([[origin,[...new Set(selected.map(d=>input[d.address]))]]]),documents=new Map();
 const queue=selected.map(d=>({origin:input[d.address],interface:d.interface}));
 while(queue.length) {
  const item=queue.shift();
  try{originOf(item.origin);}catch{throw invalid('A selected dependency must be an exact HTTPS origin.');}
  if(item.origin===origin)throw invalid('Selected dependencies contain a cycle.');
  let doc=documents.get(item.origin);
  if(!doc) {
   if(nodes.size>100)throw invalid('The selected dependency graph is too large.');
   try{doc=await readJson(fetcher,item.origin+'/.well-known/rer-dependencies',{timeoutMs:5000});}catch{throw missing('A selected provider dependency document is unavailable.');}
   if(doc.origin!==item.origin||doc.version!==1||!Array.isArray(doc.provides)||new Set(doc.provides).size!==doc.provides.length||doc.provides.some(i=>typeof i!=='string'||!/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(i))||!Array.isArray(doc.dependencies))throw invalid('A selected provider dependency document is invalid.');
   documents.set(item.origin,doc);
   const edges=[],interfaces=new Set();
   for(const edge of doc.dependencies) {
    if(!edge || typeof edge.interface!=='string'||!/^[a-z][a-z0-9-]*@[1-9][0-9]*$/.test(edge.interface)||interfaces.has(edge.interface)||typeof edge.optional!=='boolean'||edge.cardinality!==1)throw invalid('A selected provider dependency declaration is invalid.');
    interfaces.add(edge.interface);
    if(!edge.provider){if(!edge.optional)throw missing('A selected provider has an unlinked required dependency.');continue;}
    edges.push(edge.provider);queue.push({origin:edge.provider,interface:edge.interface});
   }
   nodes.set(item.origin,[...new Set(edges)]);
  }
  if(!doc.provides.includes(item.interface))throw invalid('The selected provider does not provide the declared interface.');
 }
 const {validateDependencyGraph}=await shared('schema/dependencies.mjs');
 try{validateDependencyGraph([...nodes].map(([id,dependencies])=>({id,dependencies})));}catch{throw invalid('Selected dependencies contain a cycle or invalid reference.');}
 for(const dependency of pending)await linkApproval({project,dependency,issuer:input[dependency.address],origin});
}
