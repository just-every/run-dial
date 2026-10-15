import { savedUploader } from './upload.mjs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
const require=createRequire(import.meta.resolve('wrangler'));
const {Miniflare}=await import(pathToFileURL(require.resolve('miniflare')));
export const instant='2027-01-01T00:00:00.000Z';
export async function saved(account){const directory=new URL(`fixtures/${account}/`,import.meta.url);return Promise.all((await readdir(directory)).filter(n=>n.endsWith('.json')).map(async name=>({name,bytes:await readFile(new URL(name,directory))})));}
export async function runtime(options={}){
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const origin=`http://127.0.0.1:${port}`,setupToken='synthetic-import-setup-token-at-least-32';
 const compiled=await build({entryPoints:[fileURLToPath(new URL('worker.ts',import.meta.url))],bundle:true,format:'esm',platform:'browser',external:['node:*','cloudflare:workers'],write:false});
 const state=options.state??await mkdtemp(join(tmpdir(),'dial-move-in-'));
 const calls=[];let mf;
 const open=async()=>{
  const env = {
   DB: {type:'d1',id:options.databaseId??'move-in'}, FILES:{type:'r2',name:'files'}, JOBS:{type:'queue',name:'jobs'},
   ...Object.fromEntries(Object.entries({ENVIRONMENT:'preview',OWNER_EMAIL:'operator@example.test',APP_URL:origin,SETUP_TOKEN:setupToken,SESSION_SECRET:'synthetic-import-session-secret-at-least-32',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-edge-key',MAIL_FROM:'noreply@example.test'}).map(([key,value])=>[key,{type:'text',value}]))
  };
  mf=new Miniflare({host:'127.0.0.1',port,cf:false,resourcePersistencePath:state,workers:[{
   config:{type:'worker',name:'move-in',compatibilityDate:'2026-09-08',compatibilityFlags:['nodejs_compat'],env,
    manifest:{mainModule:'worker.mjs',modulesRoot:state,modules:{'worker.mjs':{type:'esm',contents:compiled.outputFiles[0].text}}}},
   dev:{outboundService:{type:'fetcher',handler:async request=>{
    calls.push({url:request.url,method:request.method});
    if(request.url==='https://api.sendgrid.com/v3/mail/send'){await options.onMail?.(await request.clone().json());return new Response(null,{status:202,headers:{'x-message-id':'example-receipt'}});}
    return new Response('Unexpected external request',{status:500});
   }}}
  }]});
  return mf.getD1Database('DB');
 };
 const close=async()=>{try{await mf?.dispose();}finally{if(!options.state)await rm(state,{recursive:true,force:true});}};
 try{
 let db=await open();
 if(options.initialize!==false)for(const folder of ['core','ext']){const directory=new URL(`../../migrations/${folder}/`,import.meta.url);const names=await readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;});for(const name of names.filter(n=>n.endsWith('.sql')).sort())await db.batch(splitSqlQuery(await readFile(new URL(name,directory),'utf8')).map(sql=>db.prepare(sql)));}
 let cookie;
 const api=(path,init={})=>fetch(origin+path,{redirect:'manual',...init,headers:{origin,host:new URL(origin).host,...(cookie?{cookie}:{}),...init.headers}});
 const boot=await api('/auth/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:setupToken,displayName:'Example',returnTo:'/app'})});
 assert.equal(boot.status,303,'native owner bootstrap');cookie=boot.headers.get('set-cookie').split(';')[0];
 const authenticated=await api('/auth/session');assert.equal(authenticated.status,200,'native owner session');const owner=await authenticated.json();
 const upload=savedUploader(api,instant);
 return {get db(){return db;},calls,api,upload,session:owner.id,operator:owner.operator.id,async restart(){await mf.dispose();db=await open();},async offline(action){await mf.dispose();try{return await action();}finally{db=await open();}},close};
 }catch(error){await close();throw error;}
}
