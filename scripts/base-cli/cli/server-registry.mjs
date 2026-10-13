import { createConnection, createServer } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { userInfo, tmpdir } from 'node:os';
import { chmod, realpath, unlink, lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { processInfo } from '../modules/job-queue/processes.mjs';
import { identity, alive } from '../modules/job-queue/identity.mjs';
import { transaction } from '../modules/job-queue/storage.mjs';
import { refuse, invalid } from './errors.mjs';
import { serverDefaults } from './contract.mjs';
import { availableMemory } from '../modules/job-queue/resources.mjs';

export function positive(value, name, fallback) {
 if(value===undefined)return fallback;
 if(!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))throw invalid(`${name} must be positive integer seconds/count.`);
 return Number(value);
}
export const stopInstruction = record => `rer ${record.mode} --cwd ${JSON.stringify(record.checkout)} --stop`;
// Plain-words listing of one running server for the limit refusal.
const listing = record => `  ${record.mode} on port ${record.port ?? '(starting)'} in ${record.checkout}\n    stop it with: ${stopInstruction(record)}`;
export const description = record => `${record.mode} ${record.url ?? '(starting)'} for ${record.checkout}; stop it with: ${stopInstruction(record)}`;
// A test or CI journey declares itself, the way RER_SERVERS_LOAD_THRESHOLD
// declares load. It serves on its own port and never counts toward the cap.
export const declaresJourney = env => {
 if(env.RER_SERVER_JOURNEY===undefined)return false;
 if(env.RER_SERVER_JOURNEY==='1')return true;
 throw invalid('RER_SERVER_JOURNEY must be 1 to declare a test or CI journey.');
};
async function request(record, action) {
 return new Promise((resolveRequest,reject)=>{
  const socket=createConnection(record.control);let text='';
  socket.setTimeout(35000,()=>socket.destroy(Error('Managed server did not complete cleanup.')));
  socket.on('connect',()=>socket.end(JSON.stringify({token:record.token,action})));
  socket.on('data',chunk=>{text+=chunk;if(text.length>16384)socket.destroy(Error('Invalid managed server reply.'));});
  socket.on('end',()=>{try{const value=JSON.parse(text);if(value.token!==record.token)throw Error('Unverified server');resolveRequest(value);}catch(error){reject(error);}});
  socket.on('error',reject);
 });
}

// A new server starts only while this much memory is available. An idle dev
// server holds 0.5-1.3 GiB (preview 0.4-0.8 GiB), so 1.5 GiB leaves room for the
// largest one measured to start and settle. Below it the OS is already compressing
// and swapping, and one more server makes every running one slower.
export const defaultMemoryFloor=1.5*1024**3;
export function memoryFloor(env=process.env){
 const value=env.RER_SERVERS_MIN_MEMORY_BYTES;
 if(value===undefined)return defaultMemoryFloor;
 if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw invalid('RER_SERVERS_MIN_MEMORY_BYTES must be a number of bytes, 0 for no floor.');
 return Number(value);
}
function memoryMessage(counted,available,floor,mode) {
 const gib=bytes=>(bytes/1024**3).toFixed(1);
 const head=`Not started: this computer is short of memory. ${gib(available)} GiB is available and a new server starts only at ${gib(floor)} GiB or more.`;
 const list=counted.length?`Running now:\n${counted.map(listing).join('\n')}\nA dev server holds about 0.5-1.3 GiB and a preview 0.4-0.8 GiB; stopping one with its command above frees that.`:'No dev or preview server is running, so something else is using the memory.';
 return `${head}\n${list}\nTo start anyway, lower the floor, for example RER_SERVERS_MIN_MEMORY_BYTES=${Math.floor(floor/2)} rer ${mode} (0 turns it off).`;
}
function limitMessage(counted,cap,explicit,mode) {
 const holders=explicit?[]:counted.filter(item=>item.explicit&&item.limit===cap);
 const head=`Not started: ${counted.length} dev or preview ${counted.length===1?'server is':'servers are'} running on this computer and the limit is ${cap}.`;
 const list=`Running now:\n${counted.map(listing).join('\n')}`;
 const raise=holders.length
  ?`The limit is ${cap} because ${holders.length===1?'a server was':'servers were'} started with RER_SERVER_LIMIT=${cap} (${holders.map(item=>item.checkout).join(', ')}). Stop ${holders.length===1?'it':'them'} and start again, or start everything with a higher RER_SERVER_LIMIT=N.`
  :explicit?`This start set RER_SERVER_LIMIT=${cap}; to allow more, start it with a higher RER_SERVER_LIMIT=N.`
  :`To allow more, start this one with a higher limit, for example RER_SERVER_LIMIT=${cap*2} rer ${mode}. Servers started without RER_SERVER_LIMIT allow ${defaultServerLimit}.`;
 return `${head}\n${list}\nTo make room, stop one with its command above. ${raise}`;
}
// A server is only ever stopped by the checkout that owns it, through its own
// --stop, idle timeout or signal. Capacity never stops another checkout's
// server: a request over the cap is refused with the running servers named.
// Lock order: short machine transaction -> reserve checkout; release transaction
// before queue admission/local operation. Stop waits for process+state cleanup,
// which never needs the machine transaction. Generation removal happens last.
// The limit is 10 unless the person sets RER_SERVER_LIMIT. Every record keeps the
// limit it started with and whether the person set it. A start that sets
// RER_SERVER_LIMIT is capped by that value alone, higher or lower than any
// running server's. A start that sets nothing is capped by the lowest limit a
// running server's person set explicitly, so a deliberate "RER_SERVER_LIMIT=3"
// keeps holding starts that do not say otherwise. A recorded default (including
// the old default of 2 in records written before this rule) never lowers the cap
// below the current default.
export const defaultServerLimit=serverDefaults.serverLimit;
export const serversDirectory=(env=process.env)=>resolve(env.RER_SERVERS_DIR??join(userInfo().homedir,'.rer/servers'));
export async function serverRegistry(root,{env=process.env,memory=availableMemory}={}) {
 const floor=memoryFloor(env),explicit=env.RER_SERVER_LIMIT!==undefined,limit=positive(env.RER_SERVER_LIMIT,'RER_SERVER_LIMIT',defaultServerLimit),journey=declaresJourney(env);
 const checkout=await realpath(root), lifetime=await identity();
 const directory=serversDirectory(env);
 let secured;
 async function secure(){
  for(const path of [directory,join(directory,'locks')]){
   await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
   if(info.isSymbolicLink()||!info.isDirectory()||info.uid!==process.getuid())throw refuse('Server registry directory is foreign or linked. Preserve it and choose an owned RER_SERVERS_DIR.');
   await chmod(path,0o700);
  }
  try{const info=await lstat(join(directory,'state.json'));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.uid!==process.getuid())throw refuse('Server registry state is foreign or linked. Preserve it for inspection.');await chmod(join(directory,'state.json'),0o600);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const change=async action=>{await (secured??=secure());return transaction(directory,lifetime.info,action);};
 let owned, control, closing;
 async function inspect(state) {
  const kept=[];
  for(const record of state.running){
   let live;try{live=await alive(record.owner);}catch{throw refuse(`Unverifiable server identity: ${description(record)}. Preserve it for inspection.`);}
   if(live) kept.push(record);
   else {
    const current=await processInfo(record.owner.pid);
    if(current&&!current.zombie&&current.start===record.owner.start)throw refuse(`Server lifetime cannot be verified: ${description(record)}. Preserve its process.`);
    // A runtime capability grants recovery only to the captured process scope.
    if(record.runtime) {
     const { shared }=await import('./shared.mjs');
     const { recoverCommand }=await shared('command-recovery.mjs');
     await recoverCommand(record.runtime);
    }
   }
  }
  state.running=kept;
 }
 async function existing(mode,options,{stop=false}={}) {
  return change(async state=>{
   await inspect(state);const record=state.running.find(item=>item.checkout===checkout);
   if(!record)return null;
   if(record.mode!==mode)throw refuse(`This checkout already owns ${description(record)}.`);
   if(!stop && (options.supplied.has('--host')&&record.host!==undefined&&options.host!==record.host || options.supplied.has('--port')&&record.port!==undefined&&options.port!==record.port || options.supplied.has('--idle-timeout')&&options.idleTimeout!==record.idleTimeout))throw refuse(`Options conflict with ${description(record)}.`);
   return record;
  });
 }
 async function stop(mode,options) {
  try{await lstat(join(directory,'state.json'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  const record=await existing(mode,options,{stop:true});if(!record)return;
  await request(record,'stop');
  await change(state=>{state.running=state.running.filter(item=>item.generation!==record.generation);});
 }
 async function reserve(mode,options) {
  return change(async state=>{
   await inspect(state);
   const same=state.running.find(item=>item.checkout===checkout);
   if(same)return {existing:same};
   // Journeys are listed but uncounted: they neither use nor lower the cap.
   const counted=state.running.filter(item=>!item.journey),cap=explicit?limit:Math.min(limit,...counted.filter(item=>item.explicit).map(item=>item.limit));
   if(!journey&&counted.length>=cap)throw refuse(limitMessage(counted,cap,explicit,mode));
   // Unreadable memory is not a reason to refuse; only a reading below the floor is.
   const available=journey||floor===0?NaN:await memory();
   if(available<floor)throw refuse(memoryMessage(counted,available,floor,mode));
   owned={checkout,mode,journey,generation:randomUUID(),token:randomUUID(),owner:lifetime.info,limit,explicit,startedAt:Number(process.hrtime.bigint()/1000000n),idleTimeout:options.idleTimeout};
   owned.lastActivity=owned.startedAt;owned.active=0;
   const name=`rer-server-${createHash('sha256').update(owned.generation).digest('hex').slice(0,20)}.sock`;
   owned.control=join(tmpdir(),name);if(Buffer.byteLength(owned.control)>=100)owned.control=join('/tmp',name);
   owned.runtime={pid:process.pid,token:owned.token};
   state.running.push(owned);return {owned};
  });
 }
 async function serve(handler) {
  control=createServer({allowHalfOpen:true},socket=>{
   let text='';socket.setTimeout(35000,()=>socket.destroy());
   socket.on('data',data=>{text+=data;if(text.length>1024)socket.destroy();});
   socket.on('end',async()=>{
    try{const request=JSON.parse(text);if(request.token!==owned.token)throw Error('Invalid capability');socket.end(JSON.stringify({...await handler(request.action),token:owned.token}));}
    catch{socket.destroy();}
   });
  });
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(owned.control,resolve);});await chmod(owned.control,0o600);
 }
 async function update(fields){Object.assign(owned,fields);await change(state=>{const item=state.running.find(item=>item.generation===owned.generation);if(!item)throw Error('Server reservation disappeared');Object.assign(item,fields);});}
 async function updateActivity(fields){await change(state=>{const item=state.running.find(item=>item.generation===owned.generation);if(item)Object.assign(item,fields);});}
 async function waitReady(record,signal){
  for(let attempt=0;attempt<1200;attempt++){
   signal?.throwIfAborted();if(!await alive(record.owner))throw refuse('Concurrent server startup failed. Retry after recovery.');
   try{const status=await request(record,'status');if(status.ready)return {...record,...status};}catch(error){if(attempt===1199)throw error;}
   await delay(250,undefined,{signal});
  }
  throw refuse('The existing server is still starting. Wait for its ready output.');
 }
 return {checkout,existing,stop,reserve,serve,update,updateActivity,waitReady,custodyToken:()=>owned?.token,
  // The sockets close even when the record cannot be removed (its registry
  // deleted under it, say): an open listener would keep this process alive.
  close(){return closing??=(async()=>{
   try{if(owned)await change(state=>{state.running=state.running.filter(item=>item.generation!==owned.generation);});}
   finally{
    try{
     if(control)await new Promise(resolve=>control.close(resolve));
     if(owned)await unlink(owned.control).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }finally{await lifetime.close();}
   }
  })();}
 };
}
