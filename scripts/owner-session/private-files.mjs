import {mkdir,lstat,realpath,chmod,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {must} from './assert.mjs';

export async function privateDirectory(path) {
 await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
 must(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path,'private-directory-custody');await chmod(path,0o700);return path;
}
export async function privateMode(path) {
 const stat=await lstat(path);must(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&await realpath(path)===path,'private-file-permissions');
}
export async function writeScreenshotEvidence(root,runId,name,bytes) {
 must(root===resolve(root)&&/^\d+$/.test(runId??'')&&/^[a-z0-9-]+$/.test(name),'screenshot-evidence-path');
 const folder=await privateDirectory(resolve(root,runId)),path=resolve(folder,name+'.png');
 await writeFile(path,bytes,{mode:0o600,flag:'wx'});await privateMode(path);return path;
}
