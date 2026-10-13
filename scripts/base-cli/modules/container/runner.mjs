import { spawn } from 'node:child_process';
import { join } from 'node:path';
export function superviseRunner({ root, manifest, settings, failed }) {
 if (!manifest.runner) return { running:()=>true, async close(){} };
 const child=spawn(process.execPath,[join(root,'runner',manifest.runner.entry)],{cwd:join(root,'runner'),env:{...process.env,...settings},stdio:['ignore','ignore','ignore']});
 let stopping=false;
 child.once('error',()=>{if(!stopping)failed();});
 child.once('exit',()=>{if(!stopping)failed();});
 return { running:()=>child.exitCode===null&&child.signalCode===null, async close(){stopping=true;if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),35000);child.once('exit',()=>{clearTimeout(timer);resolve();});});} };
}
