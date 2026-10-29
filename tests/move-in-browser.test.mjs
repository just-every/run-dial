import { fixtureVite } from "./native-process/vite.mjs";
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { resolve } from 'node:path';
import { contract } from './contract.mjs';
import { evidencePath } from '../scripts/evidence-path.mjs';
contract(['DATA-003','MIGRATE-004'],'real hydrated move-in journeys and axe at 1440 and 390 cover reports, choices, apply, booking occupancy and undo',async()=>{
 for(const width of [1440,390]){
  const state=await mkdtemp(resolve(tmpdir(),'dial-move-in-browser-'));const origin='http://127.0.0.1:15754',config=resolve('tests/move-in/browser.wrangler.toml');
  const env={...process.env,CI:'1',DIAL_WRANGLER_CONFIG_PATH:config,DIAL_PERSIST_STATE_DIR:state,DIAL_INSPECTOR_PORT:'15755',DIAL_REVIEW_ORIGIN:origin,DIAL_MOVE_IN_WIDTH:String(width)};let server,output='';
  const run=(args,overrides={})=>new Promise((done,reject)=>{const child=spawn(args[0],args.slice(1),{env:{...env,...overrides},stdio:'pipe'});let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});child.on('error',reject);child.on('exit',code=>code===0?done():reject(new Error(log)));});
  try{
   await run(['pnpm','exec','wrangler','d1','migrations','apply','dial-move-in-browser-test','--local','--persist-to',state,'--config',config]);
   server=spawn('pnpm',[...fixtureVite,'--host','127.0.0.1','--port','15754','--strictPort'],{env,stdio:'pipe',detached:true});server.stdout.on('data',b=>{output+=b;});server.stderr.on('data',b=>{output+=b;});
   for(let attempt=0;;attempt++){if(server.exitCode!==null||attempt>480)throw new Error(output.slice(-15000));try{if((await fetch(origin+'/health')).ok)break;}catch{/* Wait for native startup. */}await new Promise(done=>setTimeout(done,125));}
   await run(['node','scripts/verify-move-in-browser.mjs'],{HOME:userInfo().homedir});
  }finally{
   if(server?.exitCode===null){const stopped=new Promise(done=>server.once('exit',done));try{process.kill(-server.pid,'SIGTERM');}catch{server.kill('SIGTERM');}await stopped;}
   await writeFile(evidencePath(`move-in-${width}-worker.log`),output);await rm(state,{recursive:true,force:true});
  }
 }
});
