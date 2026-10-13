import {execFileSync} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commands} from './commands.mjs';
import {liveRows} from './live-rows.mjs';

// Dispatch stays in source control; receipts, credentials and the scoped provider
// helpers belong to the explicitly selected private owner-session workspace.
export async function runOwnerSession(argv = process.argv.slice(2), workspace = process.env.DIAL_OWNER_SESSION_WORKSPACE) {
 const argsTail=[...argv];
 if(argsTail[0]==='--workspace') { argsTail.shift(); workspace=argsTail.shift(); }
 if(argsTail[0]==='--live-rows'){console.log(JSON.stringify({ok:true,scope:'offline-session-plan',rows:liveRows.map(({id,clauses,owner,pass,command})=>({id,clauses,owner,pass,command:`node scripts/owner-session/run.mjs --workspace WORKSPACE ${command}`})),networkCalls:0,deployed:false,liveProof:false}));return;}
 const dryRun=argsTail[0]==='--dry-run'; if(dryRun)argsTail.shift();
 const command=argsTail.shift();
 if(command!=='--check'&&!Object.hasOwn(commands,command))throw new Error('unknown-command');
 if(dryRun){
  if(command==='--check')throw new Error('dry-run-requires-command');
  console.log(JSON.stringify({ok:true,scope:'offline-dispatch-only',command,dispatch:commands[command],argumentCount:argsTail.length,networkCalls:0,deployed:false,liveProof:false}));return;
 }
 if(!workspace||!isAbsolute(workspace))throw new Error('explicit-absolute-workspace-required');
 if(process.env.NODE_OPTIONS||process.env.NODE_PATH)throw new Error('unsafe-node-environment');
 const {childEnv,work,source,main,must,save}=await import(pathToFileURL(resolve(workspace,'owner-session/support.mjs')));
 must(work===resolve(workspace),'workspace-custody');
 await main(async()=>{
 if(command==='--check'){
  let checked=0;for(const folder of ['owner-session','disposable'])for(const file of await readdir(resolve(work,folder)))if(file.endsWith('.mjs')){execFileSync(process.execPath,['--check',resolve(work,folder,file)],{stdio:['ignore','pipe','pipe']});checked++;}
  for(const file of ['src/core/platform/crypto/sealed.ts','src/core/features/public-booking/routes.ts','src/core/features/availability-requests/routes.ts','scripts/deploy.mjs','scripts/teardown.mjs'])must((await readFile(resolve(source,file))).length>0,'required-source-missing');
  console.log(JSON.stringify({ok:true,scope:'local-syntax-and-source-paths-only',scripts:checked,networkCalls:0,deployed:false,liveProof:false}));return;
 }
must(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'unsafe-node-environment');
 const args=[resolve(work,commands[command][0]),...commands[command].slice(1),...argsTail];const at=new Date().toISOString();let status=0,stdout='';
 try{stdout=execFileSync(process.execPath,args,{cwd:work,env:await childEnv(),encoding:'utf8',stdio:['inherit','pipe','pipe'],timeout:1800000,maxBuffer:4*1024*1024});}catch(e){status=e.status??1;stdout=e.stdout?.toString()??'';const error=e.stderr?.toString().trim();if(/^\{"ok":false,"code":"[a-z0-9-]+"\}$/i.test(error??''))stdout+='\n'+error;}
 // Capture only emitted JSON summaries; never raw exception, HTTP body, argv, token, URL query, or subprocess stderr.
 const summaries=[];for(const line of stdout.trim().split('\n'))try{summaries.push(JSON.parse(line));}catch{/* Suppress all non-JSON subprocess output. */}
 if(command!=='archive')await save(`command-${command}-${Date.now()}.json`,{command,at,status,summaries});must(status===0,`command-${command}-failed-review-private-journal-no-blind-retry`);for(const row of summaries)console.log(JSON.stringify(row));
 });
}
export async function runCli(argv, workspace) {
 try { await runOwnerSession(argv,workspace); }
 catch(error) { console.error(JSON.stringify({ok:false,code:/^[a-z0-9-]+$/i.test(error.message)?error.message:'failed-sensitive-details-suppressed'}));process.exitCode=1; }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await runCli();
