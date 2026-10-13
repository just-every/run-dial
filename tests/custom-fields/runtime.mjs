import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_splitSqlQuery as splitSql } from 'wrangler';
import { openInstall } from '../archive/operator-runtime.mjs';
import { nativeFixture } from './fixture.mjs';
import { quote, restoreStatements } from '../../scripts/archive/schema.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
export async function fieldRuntime() {
 const root = await mkdtemp(join(tmpdir(),'dial-custom-fields-'));
 await writeFile(join(root,'.dev.vars'), 'ENVIRONMENT=development\nOWNER_EMAIL=owner@example.test\nSESSION_SECRET=synthetic-custom-fields-owner-secret-32chars\nSETUP_TOKEN=synthetic-custom-fields-setup-token-32chars\nMAIL_PROVIDER=development\nMAIL_FROM=no-reply@example.test\n');
 let runtime;
 try {
  runtime = await openInstall(root,new URL('./worker.ts',import.meta.url).pathname); const db = runtime.env.DB;
  const directory = new URL('../../migrations/core/',import.meta.url);
  const files = (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
  const extension = files.find(name=>name.endsWith('_extension_custom_fields.sql'));
  assert.ok(extension);
  for(const file of files.filter(name=>name !== extension)) await db.batch(splitSql(await readFile(new URL(file,directory),'utf8')).map(sql=>db.prepare(sql)));
  const source = await nativeFixture();
  try {
   const tables = [...exported,...Object.keys(excluded)].filter(name=>!name.startsWith('ext_custom_field_')).map(name=>({name,rows:source.db.prepare(`SELECT * FROM ${quote(name)}`).all()}));
   const triggers = (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()).results;
   await db.batch(restoreStatements(tables,triggers).map(({sql,params})=>db.prepare(sql).bind(...params)));
   const snapshot = async()=>Object.fromEntries(await Promise.all(tables.map(async({name})=>[name,(await db.prepare(`SELECT * FROM ${quote(name)}`).all()).results])));
   const before = await snapshot();
   await db.batch(splitSql(await readFile(new URL(extension,directory),'utf8')).map(sql=>db.prepare(sql)));
   assert.deepEqual(await snapshot(),before,'additive field migration preserves every populated prior application table');
  } finally {source.db.close();}
  await db.prepare("UPDATE event_types SET slug='custom-event'").run();
  await db.prepare("UPDATE bookings SET location_type='link',location_label='Video call',location_value='https://meeting.example.test/private'").run();
  // Prevent old synthetic fixture delivery work from being enqueued while proving private field writes.
  await db.prepare("UPDATE delivery_outbox SET state='succeeded'").run();
  const {cookie} = await runtime.signIn();
  const origin = new URL((await runtime.request('/health')).url).origin;
  const request = async(path,{method='GET',body,auth=true,originHeader=origin}={})=>fetch(origin+path,{method,redirect:'manual',headers:{origin:originHeader,'content-type':'application/json',...(auth?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const json = async(path,options,status=200)=>{const response=await request(path,options);assert.equal(response.status,status,`${options?.method??'GET'} ${path}: ${await response.clone().text()}`);return response.json();};
  return {db,request,json,origin, async close(){await runtime.dispose();await rm(root,{recursive:true,force:true});}};
 }catch(error){await runtime?.dispose();await rm(root,{recursive:true,force:true});throw error;}
}
