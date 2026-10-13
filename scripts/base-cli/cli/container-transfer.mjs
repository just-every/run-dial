import { writeFile, mkdir, mkdtemp, link, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileRecords } from '../modules/portability/files.mjs';
const execute=promisify(execFile);
export async function containerTransfer({root,path,journal,store,signal,direction,binding,buckets,policy,transient}) {
 if(direction==='import')for(const file of [path,journal].filter(Boolean))for await(const record of fileRecords(file)){}
 const spec={direction,binding,buckets,policy,transient,file:basename(path),journal:journal?'/private/later.rer':undefined};
 const encoded=JSON.stringify(spec,(_key,value)=>{if(typeof value==='function')throw new Error('Container local transfer needs a serializable archive policy; use native remote transport for this product');return value;});
 const configuration=join(root,'.rer/container/transfer.json');await mkdir(dirname(configuration),{recursive:true,mode:0o700});await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(configuration,encoded,{mode:0o600});
 const identity='rer-local-'+createHash('sha256').update(root).digest('hex').slice(0,16),image=identity+':candidate',name='rer-transfer-'+randomUUID();
 let child,temporary;
 try {
  await execute('docker',['create','--name',name,'--entrypoint','sh','-v',identity+'-data:/data',image,'-c','umask 077; exec flock -n --no-fork /data/host.lock node /runtime/modules/container/transfer.mjs']);
  await execute('docker',['cp',configuration,name+':/private/transfer.json']);
  if(direction==='import'){
   await execute('docker',['cp',path,name+':/archive/'+spec.file]);
   if(journal)await execute('docker',['cp',journal,name+':/private/later.rer']);
  }
  child=store.spawn('Transferring container archive','docker',['start','--attach',name],{cwd:root,signal});
  let output='';child.stdout.on('data',chunk=>output+=chunk);const code=await new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('close',resolve);});await store.stop(child);
  if(code!==0)throw new Error('Container archive transfer failed');const receipt=JSON.parse(output.trim().split('\n').at(-1));
  if(direction==='export'){
   temporary=await mkdtemp(join(dirname(path),'.rer-transfer-'));
   const copied=join(temporary,'archive.rer');await execute('docker',['cp',name+':/archive/'+spec.file,copied]);
   for await(const record of fileRecords(copied)){}
   await link(copied,path);
  }
  return{target:'local',platform:'container',...receipt};
 }finally{
  await store.stop(child).catch(()=>{});await execute('docker',['stop','-t','10',name]).catch(()=>{});await execute('docker',['rm','-f',name]).catch(()=>{});if(temporary)await rm(temporary,{recursive:true,force:true});
 }
}
