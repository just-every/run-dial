import {loadavg,tmpdir} from 'node:os';
import {statfs} from 'node:fs/promises';
import {refuse} from './errors.mjs';
// Persistent serving is not a bounded queue job. Check its launch separately,
// after finite preparation, while its canonical server reservation is held.
// The 1-minute-load guard is a fleet's rule, set in the fleet's environment:
// without RER_SERVERS_LOAD_THRESHOLD a person's start is never refused for load.
export function servingLoadThreshold(env=process.env){
 if(env.RER_SERVERS_LOAD_THRESHOLD===undefined)return Infinity;
 const threshold=Number(env.RER_SERVERS_LOAD_THRESHOLD);
 if(!Number.isFinite(threshold)||threshold<0)throw refuse('Invalid server load threshold.');
 return threshold;
}
export async function serverResources(root,{load=()=>loadavg()[0],disk=statfs,env=process.env}={}){
 const threshold=servingLoadThreshold(env);
 const measured=threshold===Infinity?0:await load();
 if(!Number.isFinite(measured)||measured>threshold)throw refuse(`Not started: this computer is busy. Its 1-minute load is ${Number.isFinite(measured)?measured.toFixed(1):'unknown'} and a server starts only at ${threshold} or below.\nTry again in a few minutes, or start it anyway with a higher threshold, for example RER_SERVERS_LOAD_THRESHOLD=${Math.ceil(Math.max(threshold,Number.isFinite(measured)?measured:0)*2)} rer dev.`);
 for(const path of new Set([root,tmpdir()])){
  const state=await disk(path,{bigint:true});
  if(state.bavail*state.bsize<15n*1024n**3n)throw refuse('Server startup requires 15 GiB free on checkout and temporary volumes. Recover owned space before retrying.');
 }
}
