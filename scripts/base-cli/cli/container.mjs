import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { shared } from './shared.mjs';
import { selectedOrigin } from './local.mjs';
import { refuse, missing } from './errors.mjs';
import { refuseLocalModels } from '../modules/deploy-kit/local-only.mjs';
import { deployInputs } from '../modules/container/deploy-input.mjs';
import { ingressBindings } from '../modules/container/ssh-plan.mjs';
import { deploySSH, sshTarget } from '../modules/container/ssh.mjs';
const execute=promisify(execFile);
async function run(command,args,options={}) {
 const child=spawn(command,args,{...options,stdio:'inherit'}),abort=()=>child.kill('SIGTERM');
 process.once('SIGTERM',abort);process.once('SIGINT',abort);
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Container command failed')));});}
 finally{process.off('SIGTERM',abort);process.off('SIGINT',abort);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');}
}
export async function containerCommand(project,options,out) {
 if(options.stop)return runContainer(project,options,out);
 const {localOperation}=await shared('local/operation.mjs'),{recoverInterrupted}=await shared('local/recovery.mjs');
 const operation=await localOperation(project.root,process.env.RER_LOCAL_OPERATION);
 try{await recoverInterrupted(project.root,operation);return await runContainer(project,options,out,operation);}catch(error){if(error.code==='SSH_HOST_REFUSAL')throw refuse(error.message);throw error;}finally{await operation.release();}
}
async function runContainer(project,options,out,operation) {
 const {root}=project;
 if(options.verb==='deploy'){try{await refuseLocalModels(root);}catch{throw refuse('Deploy refuses the local-only key file .rer/local/models.json. Remove live-dev credentials before deployment.');}}
 const config=JSON.parse(await readFile(join(root,'deploy.json'),'utf8'));
 if(!(config.platforms??['workers']).includes('container'))throw refuse('This seed does not declare container support.');
 const name='rer-local-'+createHash('sha256').update(root).digest('hex').slice(0,16),image=name+':candidate';
 if(options.stop){await execute('docker',['stop','-t','10',name]);return{stopped:true};}
 if(['build','deploy'].includes(options.verb)){
  if(options.verb==='deploy'){if(!options.host)throw missing('Container deploy requires --host ssh://user@host.');sshTarget(options.host);await deployInputs({root,envFile:options.envFile,localOnlyKeys:project.adapter?.localOnlyKeys});}
  const ingress={...(options.bindAddress?{address:options.bindAddress}:{}),...(options.httpPort?{httpPort:options.httpPort}:{}),...(options.httpsPort?{httpsPort:options.httpsPort}:{})};
  ingressBindings({...config.container?.ingress,...ingress});
  if(!options.image){
   const {withoutLocalVariables}=await shared('local/build.mjs'),{buildEnvironment}=await shared('local/environment.mjs');
   const declaration=await readFile(join(root,'seed.json'),'utf8').then(JSON.parse).catch(()=>({}));
   const declared=Array.isArray(declaration.env)?declaration.env.map(item=>item.name):Object.keys(declaration.env??{});
   await withoutLocalVariables(root,async()=>{
    const builder=fileURLToPath(new URL('../modules/container/build.mjs',import.meta.url));
    await run(process.execPath,[builder,root],{cwd:root,env:buildEnvironment([...declared,...(config.secrets??[]).flatMap(item=>[item.binding,item.environment])])});
    await run('docker',['build','--tag',image,join(root,'.rer/container/image')],{cwd:root});
   },{nested:operation.token,settings:[...(project.adapter?.settings??[]),...(project.privateInputs??[])]});
  }
  if(options.verb==='build')return{platform:'container',image};
  if(!options.host)throw missing('Container deploy requires --host ssh://user@host.');
  return deploySSH({root,image:options.image??image,ingress,host:options.host,envFile:options.envFile,environment:options.environment,localOnlyKeys:project.adapter?.localOnlyKeys,dryRun:options.dryRun});
 }
 if(['dev','preview'].includes(options.verb)){
  const selected=await selectedOrigin(project,options),env=join(root,'.rer/container/local.env');
  await mkdir(join(root,'.rer/container'),{recursive:true,mode:0o700});
  const local={...selected.vars,[config.originVar]:selected.url,PORT:'8080',RER_CONTAINER_IDLE_SECONDS:String(options.idleTimeout)};const {stdout}=await execute('docker',['image','inspect','--format','{{.Id}}',image]);local.RER_IMAGE_DIGEST=stdout.trim();
  await writeFile(env,Object.entries(local).map(([key,value])=>`${key}=${String(value).replaceAll('\n','\\n')}`).join('\n')+'\n',{mode:0o600});
  out.human('RER_OPEN '+selected.url);
  await run('docker',['run','--rm','--name',name,'--env-file',env,'-p',`${selected.host}:${selected.port}:8080`,'-v',name+'-data:/data',image],{cwd:root});
  return{platform:'container',stopped:true};
 }
 throw refuse('Unsupported container command');
}
