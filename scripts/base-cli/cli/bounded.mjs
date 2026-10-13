import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {shared} from './shared.mjs';
import {RerError} from './errors.mjs';

// Admit the complete bounded workflow before it can acquire checkout custody.
// The child re-enters the same dispatcher with validated live queue membership.
// Hold the child's semantic outcome until queue and process custody are released.
// Child diagnostics remain captured/redacted on stderr. Long-lived servers never
// enter this boundary.
export async function boundedCommand(project,options,argv,out){
 if(!['install','setup','build','verify','deploy','export','import'].includes(options.verb))return null;
 const {commandPolicy,queuedCommand,queueLabel}=await shared('queue.mjs');
 const policy=await commandPolicy();
 const childArgs=[...argv];const cwdIndex=childArgs.indexOf('--cwd');if(cwdIndex>=0&&(childArgs.indexOf('--')<0||cwdIndex<childArgs.indexOf('--')))childArgs[cwdIndex+1]=project.root;
 const directory=await mkdtemp(join(tmpdir(),'rer-bounded-'));
 let store,result,finalEvent,errorEvent,buffer='';
 const cancellation=new AbortController();
 const handlers=new Map(['SIGINT','SIGTERM'].map(name=>[name,()=>cancellation.abort(name)]));
 for(const [name,handler] of handlers)process.on(name,handler);
 try{
  const {createCommands}=await shared('commands.mjs');
  store=await createCommands(directory,{logs:[]},{terminal:()=>{}});
  result=await queuedCommand(process.execPath,[fileURLToPath(new URL('../bin/rer.mjs',import.meta.url)),...childArgs],{
   cwd:project.root,signal:cancellation.signal,stdio:[!options.json&&!options.nonInteractive?'inherit':'ignore','pipe','pipe'],originalCI:policy.ci,env:{...process.env,...policy.environment,RER_BOUNDED_OUTPUT:'1'},
   label:await queueLabel(project.root,options.verb,'workflow'),report:text=>out.progress(store.redact(text)+'\n'),onWaiting:options.json?details=>out.event('waiting',details):undefined,
   spawn:(command,args,native)=>{
    const child=store.spawn('Running bounded workflow',command,args,native);
    const stderr=store.redactionStream(text=>out.progress(text));
    child.stderr.on('data',chunk=>stderr.write(chunk));child.stderr.once('end',()=>stderr.end());
    child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
     let event;try{event=JSON.parse(line);}catch{}
     if(event?.version===1&&event.verb===options.verb){
      if(event.event==='result')finalEvent=event;
      else if(event.event==='error')errorEvent=event;
      else out.human(store.redact(JSON.stringify(event)));
     }else if(!options.json)out.human(store.redact(line));
    }});
    child.stdout.once('end',()=>{if(buffer&&!options.json)out.human(store.redact(buffer));buffer='';});return child;
   },
   cleanup:async child=>{
    await store.stop(child);
    if(project.profile==='first-party'){
     const {recoverInterrupted}=await shared('local/recovery.mjs');
     const held=await recoverInterrupted(project.root);await held?.release();
    }
   }
  });
 }finally{
  try{await store?.closeCommands();await policy.close();await rm(directory,{recursive:true,force:true});}
  finally{for(const [name,handler] of handlers)process.off(name,handler);}
 }
 const termination=cancellation.signal.aborted?cancellation.signal.reason:undefined;
 if(!result&&!termination)return null;
 const exitCode=termination?(termination==='SIGINT'?130:143):result.code;
 if(termination){
  out.error(new RerError('cancelled',`Stopped by ${termination} after owned children were stopped.`,exitCode));
  out.result(false,exitCode);
 }else if(finalEvent&&finalEvent.exitCode===exitCode){
  if(errorEvent)out.error(new RerError(errorEvent.code,store.redact(errorEvent.message),exitCode));
  const {version,verb,event,ok,exitCode:childExit,...details}=finalEvent;
  out.result(exitCode===0,exitCode,JSON.parse(store.redact(JSON.stringify(details))));
 }else{
  const error=new RerError('command_failed',result.supervisorEnded?store.redact(result.error):'Bounded command ended before its result; owned children and private files were recovered.',exitCode||1);
  out.error(error);out.result(false,error.exitCode);return {exitCode:error.exitCode};
 }
 return {exitCode};
}
