import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {assertNoSecretValues,equivalentArchive,inspectArchiveSecrets} from '../../scripts/owner-session/export-proof.mjs';
contract('DATA-001', 'archive comparison scans credentials and encoded representations without disclosing their values',()=>{
 const secret='synthetic/private?secret=only';
 assert.equal(assertNoSecretValues('{"profile":"QA"}',[secret]).checked,1);
 for(const representation of [secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64'),Buffer.from(secret).toString('base64url')])assert.throws(()=>assertNoSecretValues(JSON.stringify({value:representation}),[secret]),error=>error.message==='export-contains-install-secret');
 assert.throws(()=>assertNoSecretValues('{}',[]),/comparison-empty/);
});
contract('DATA-001', 'archive equivalence keeps application timestamps and object bytes while ignoring only selected top-level export metadata',()=>{
 const source={version:1,exportedAt:'one',rows:[{id:'record',createdAt:'original'}],objects:[{key:'file',base64:'aGVsbG8=',contentType:'text/plain'}]};
 const next={objects:source.objects,rows:source.rows,version:1,exportedAt:'two'};
 assert.equal(equivalentArchive(source,next,{volatileKeys:['exportedAt']}),true);
 assert.throws(()=>equivalentArchive(source,next),/round-trip-different/);
 for(const mutate of [x=>{x.rows[0].createdAt='changed';},x=>{x.objects[0].base64='Y2hhbmdlZA==';},x=>{x.objects[0].contentType='application/json';}]){const changed=structuredClone(next);mutate(changed);assert.throws(()=>equivalentArchive(source,changed,{volatileKeys:['exportedAt']}));}
 assert.throws(()=>equivalentArchive(source,next,{volatileKeys:['rows']}),/not-metadata/);
});

contract('BASE-SECRET-001','stream proof catches install credentials across chunk boundaries without buffering object bodies',async()=>{
 const secret='synthetic-private-proof-value';
 async function* chunks(value){for(let i=0;i<value.length;i+=3)yield Buffer.from(value.slice(i,i+3));}
 const result=await inspectArchiveSecrets(chunks('safe archive stream'),[secret]);assert.equal(result.checked,1);assert.equal(result.bytes,19);assert.match(result.archiveSha256,/^[a-f0-9]{64}$/);
 for(const value of [secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64'),Buffer.from(secret).toString('base64url')])await assert.rejects(()=>inspectArchiveSecrets(chunks('prefix'+value+'suffix'),[secret]),/contains-install-secret/);
});

contract('DATA-001','archive comparison preserves exact large integers and per-object checksum metadata',()=>{
 const archive={format:'normalized-proof',tables:[{name:'example',rows:[{value:JSON.rawJSON('9223372036854775807')}]}],objects:[{key:'asset',size:3,sha256:'a'.repeat(64),contentType:'application/octet-stream'}]};
 assert.equal(equivalentArchive(archive,archive),true);
 assert.throws(()=>equivalentArchive(archive,{...archive,objects:[{...archive.objects[0],sha256:'b'.repeat(64)}]}),/round-trip-different/);
 assert.throws(()=>equivalentArchive(archive,{...archive,tables:[{name:'example',rows:[{value:JSON.rawJSON('9223372036854775806')}]}]}),/round-trip-different/);
});
