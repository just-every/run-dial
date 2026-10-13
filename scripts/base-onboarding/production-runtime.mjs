import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {projectMiniflare} from './production-options.mjs';

// Preview's resident process. Wrangler resolves the Worker's options in a
// short-lived child that exits before serving starts; this process then holds
// only the pinned Miniflare, which owns one workerd and no bundler or
// file/config watcher.
let planner,stopping,runtime;
const stop=()=>stopping??=(async()=>{planner?.kill('SIGTERM');await runtime?.dispose();})();
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
async function plan(){
 let text='';
 planner=spawn(process.execPath,[fileURLToPath(new URL('./production-plan.mjs',import.meta.url))],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','inherit']});
 planner.stdout.setEncoding('utf8').on('data',chunk=>{text+=chunk;});
 const code=await new Promise((done,fail)=>{planner.once('error',fail);planner.once('close',done);});
 if(stopping)return undefined;
 if(code!==0)throw Error('Resolving the Worker configuration failed.');
 return JSON.parse(text);
}
try{
 const options=await plan();
 if(options){
  const {Miniflare,convertV4MiniflareOptions}=await projectMiniflare(process.cwd());
  runtime=new Miniflare({...convertV4MiniflareOptions(options),resourcePersistencePath:resolve(process.cwd(),'.wrangler/state/v3')});
  if(stopping)await runtime.dispose();
  else await runtime.ready;
 }
}catch(error){await stop();throw error;}
