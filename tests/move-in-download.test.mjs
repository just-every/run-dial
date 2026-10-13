import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.mjs';
import { download } from '../scripts/move-in/download.mjs';
const fixture=new URL('./move-in/fixtures/edges/',import.meta.url);
contract('DATA-003','local GET-only downloader retains exact paged bytes and fails closed without disclosing credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dial-download-'));const planted='synthetic-download-secret-EXAMPLE';let mode='ok',attempt=0;const calls=[];
 const server=createServer(async(req,res)=>{
  calls.push({method:req.method,url:req.url,hasCredential:req.headers.authorization===`Bearer ${planted}`});
  if(mode==='redirect'){res.writeHead(302,{location:'https://untrusted.example.test/'});res.end();return;}
  if(mode==='cycle'){res.setHeader('content-type','application/json');res.end(JSON.stringify({resource:{uri:'https://api.calendly.com/users/edges'},pagination:{next_page:'https://api.calendly.com/users/me'}}));return;}
  if(mode==='401'||mode==='403'||mode==='500'||mode==='429'){res.writeHead(Number(mode),{'Retry-After':'0'});res.end(planted);return;}
  if(mode==='retry'&&attempt++===0){res.writeHead(429,{'Retry-After':'0'});res.end();return;}
  let file;const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/users/me')file='user-1.json';
  else if(url.pathname==='/event_types')file=`event_types-${url.searchParams.get('page_token')==='empty'?2:url.searchParams.get('page_token')==='last'?3:1}.json`;
  else if(url.pathname==='/user_availability_schedules')file='schedules-1.json';
  else if(url.pathname==='/event_type_availability_schedules'){
   const all=JSON.parse(await readFile(new URL('event_availability-1.json',fixture),'utf8'));all.collection=all.collection.filter(e=>e.event_type===url.searchParams.get('event_type'));res.end(JSON.stringify(all));return;
  }else if(url.pathname==='/scheduled_events')file=`scheduled_events-${url.searchParams.get('page_token')==='empty'?2:url.searchParams.get('page_token')==='last'?3:1}.json`;
  else file=`invitees-${url.pathname.match(/edges-(\d+)/u)?.[1]}.json`;
  try{res.end(await readFile(new URL(file,fixture)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const local=`http://127.0.0.1:${server.address().port}`;
 const transport=async request=>{assert.equal(new URL(request.url).origin,'https://api.calendly.com');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'manual');const original=new URL(request.url);const response=await fetch(new Request(local+original.pathname+original.search,{method:request.method,headers:request.headers,credentials:request.credentials,redirect:request.redirect}));return new Response(response.body,{status:response.status,headers:response.headers});};
 try{
  for(const variant of ['ok','retry']){mode=variant;const out=join(root,variant);const summary=await download({out,token:planted,transport,sleep:async()=>{},asOf:'2027-01-01T00:00:00.000Z'});assert.match(summary,/Upload this folder/);assert.ok(!summary.includes(planted));assert.equal((await stat(out)).mode&0o777,0o700);const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));assert.ok(manifest.files.some(f=>f.resource==='event_types'&&f.page===2));for(const item of manifest.files){const bytes=await readFile(join(out,item.name));assert.equal(bytes.length,item.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);if(item.resource==='event_types')assert.deepEqual(bytes,await readFile(new URL(`event_types-${item.page}.json`,fixture)));}for(const name of await readdir(out)){assert.equal((await stat(join(out,name))).mode&0o777,0o600);assert.ok(!(await readFile(join(out,name),'utf8')).includes(planted));}assert.ok(calls.every(c=>c.method==='GET'&&c.hasCredential));await assert.rejects(()=>download({out,token:planted,transport}),/already exists/);}
  for(const variant of ['401','403','500','429','redirect','cycle']){mode=variant;const out=join(root,variant);await assert.rejects(()=>download({out,token:planted,transport,sleep:async()=>{}}),e=>!e.message.includes(planted));await assert.rejects(()=>stat(out),{code:'ENOENT'});}
  await assert.rejects(()=>download({out:join(root,'network'),token:planted,transport:async()=>{throw new Error(planted);}}),e=>!e.message.includes(planted)&&e.message.includes('retry later'));
 }finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
