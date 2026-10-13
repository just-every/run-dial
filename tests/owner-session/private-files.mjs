import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,lstat,chmod,mkdir,symlink,rm,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {privateMode,writeScreenshotEvidence} from '../../scripts/owner-session/private-files.mjs';

contract('BASE-SECRET-001','private evidence requires exact owner-only regular files without ancestor aliases',async t=>{
 // macOS tmpdir() sits under the /var alias that private paths refuse.
 const root=await realpath(await mkdtemp(resolve(tmpdir(),'owner-session-private-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=resolve(root,'synthetic.json');await writeFile(file,'{}',{mode:0o600});await privateMode(file);
 for(const mode of [0o644,0o400,0o700]){await chmod(file,mode);await assert.rejects(()=>privateMode(file),/private-file-permissions/);}await chmod(file,0o600);
 await symlink(file,resolve(root,'linked.json'));await assert.rejects(()=>privateMode(resolve(root,'linked.json')),/private-file-permissions/);
 await mkdir(resolve(root,'real'));await writeFile(resolve(root,'real/data.json'),'{}',{mode:0o600});await symlink(resolve(root,'real'),resolve(root,'alias'));await assert.rejects(()=>privateMode(resolve(root,'alias/data.json')),/private-file-permissions/);
});
contract('BASE-SECRET-001','screenshot files preserve run identity and reject overwrite and symlink destinations',async t=>{
 const root=await realpath(await mkdtemp(resolve(tmpdir(),'owner-session-screenshot-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=Buffer.from('synthetic-test-image'),path=await writeScreenshotEvidence(root,'123','owner-1440',bytes);
 assert.equal(path,resolve(root,'123/owner-1440.png'));assert.equal((await lstat(path)).mode&0o777,0o600);
 await assert.rejects(()=>writeScreenshotEvidence(root,'123','owner-1440',bytes),{code:'EEXIST'});assert.equal(await readFile(path,'utf8'),'synthetic-test-image');
 const target=resolve(root,'target.png');await writeFile(target,'preserve-this',{mode:0o600});await rm(path);await symlink(target,path);
 await assert.rejects(()=>writeScreenshotEvidence(root,'123','owner-1440',bytes),{code:'EEXIST'});assert.equal(await readFile(target,'utf8'),'preserve-this');
 for(const [run,name] of [['../escape','owner'],['123','../escape']])await assert.rejects(()=>writeScreenshotEvidence(root,run,name,bytes),/evidence-path/);
});
