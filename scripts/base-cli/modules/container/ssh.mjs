import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deploymentPlan } from './ssh-plan.mjs';
import { deployInputs } from './deploy-input.mjs';
const execute=promisify(execFile);
export const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export function sshTarget(value){
 let url;try{url=new URL(value);}catch{throw new Error('Host must be ssh://user@host[:port]');}
 if(url.protocol!=='ssh:'||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||!url.username||!/^[a-zA-Z0-9_.-]+$/.test(url.username)||!/^([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])$/.test(url.hostname))throw new Error('Invalid ssh host');
 const args=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes'];
 if(process.env.RER_SSH_IDENTITY)args.push('-i',resolve(process.env.RER_SSH_IDENTITY));
 if(process.env.RER_SSH_KNOWN_HOSTS)args.push('-o','UserKnownHostsFile='+resolve(process.env.RER_SSH_KNOWN_HOSTS));
 if(url.port)args.push('-p',url.port);args.push(url.username+'@'+url.hostname.replace(/^\[|\]$/g,''));return args;
}
export async function deploySSH({root,host,image,envFile,environment='production',localOnlyKeys=[],dryRun=false,ingress}) {
 const ssh=sshTarget(host),{declaration,settings,encoded}=await deployInputs({root,envFile,localOnlyKeys});
 const {stdout:digestText}=await execute('docker',['image','inspect','--format','{{.Id}}',image]);
 const plan=deploymentPlan({declaration,settings,environment,digest:digestText.trim(),ingress});
 const directory=join(root,'.rer/container/deploy');await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(join(directory,'compose.yaml'),JSON.stringify(plan.compose,null,2)+'\n',{mode:0o600});
 await writeFile(join(directory,'Caddyfile'),plan.caddyfile,{mode:0o600});
 if(dryRun)return{dryRun:true,deployed:false,origin:plan.origin,installation:'.rer-host/'+plan.name,compose:join(directory,'compose.yaml')};
 // The code is transferred from this installation's maintained CLI. No remote
 // Python, shell or compose file is ever imported or executed from disk.
 const source=(await Promise.all(['files','resources','deploy'].map(name=>readFile(new URL('./remote/'+name+'.py',import.meta.url),'utf8')))).join('\n');
 const command='python3 -I -c '+quote(source);
 const remote=async payload=>{
  const child=spawn('ssh',[...ssh,command],{stdio:['pipe','pipe','pipe']});
  const result=completed(child,true);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));return result;
 };
 // This also proves Python and Docker availability, filesystem custody and
 // existing resource ownership before loading an image or sending secrets.
 await remote({plan,phase:'check'});
 const load=spawn('ssh',[...ssh,'docker load'],{stdio:['pipe','pipe','pipe']}),save=spawn('docker',['save',plan.digest],{stdio:['ignore','pipe','pipe']});
 load.stdin.on('error',()=>{});save.stdout.pipe(load.stdin);
 try{await Promise.all([completed(save),completed(load)]);}finally{if(save.exitCode===null)save.kill('SIGTERM');if(load.exitCode===null)load.kill('SIGTERM');}
 const result=JSON.parse(await remote({plan,files:{'settings.env':encoded,'compose.yaml':JSON.stringify(plan.compose,null,2)+'\n','Caddyfile':plan.caddyfile}}));
 const end=Date.now()+60000;
 while(Date.now()<end){
  try{const response=await fetch(plan.origin+'/health',{signal:AbortSignal.timeout(3000)});if(response.ok){const health=await response.json();if(health.platform==='container'&&health.deployment?.versionId===plan.digest)return{deployed:true,origin:plan.origin,imageDigest:plan.digest,...result};}}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('Container public health did not become ready; inspect host logs');
}

const hostRefusals=new Set(['Unsafe host path ownership, permissions or type','Unsafe account home','Account home is not owned by login user','Host deployment path changed','Host deployment file changed','Installation ownership mismatch','Unexpected deployment file','Unexpected installation path','Unexpected Docker installation resource','Unsafe Docker volume driver/options','Unsafe Docker ingress network','Foreign container uses installation volume','Foreign container uses installation network','Host ingress binding is already occupied','Host ingress binding is unavailable','Application image identity mismatch','Host deployment refused: unsafe path or failed operation']);
function hostFailure(stderr){
 const reason=stderr.trim();
 const message=hostRefusals.has(reason)||/^Docker resource ownership mismatch: (app|caddy|caddy-config|data|ingress)$/.test(reason)||/^Docker host operation failed: (image|volume|network|container)$/.test(reason)?reason:'SSH host operation failed';
 return Object.assign(Error(message),{code:'SSH_HOST_REFUSAL'});
}
function completed(child, capture=false) {
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Host operation timed out'));},120000);
  child.stdout?.on('data',chunk=>{if(capture&&stdout.length<1024*1024)stdout+=chunk;});
  child.stderr?.on('data',chunk=>{if(capture&&stderr.length<2048)stderr+=chunk;});
  child.once('error',()=>{clearTimeout(timer);reject(Error('Host operation failed'));});
  child.once('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(capture?hostFailure(stderr):Error('Host operation failed'));});
 });
}
