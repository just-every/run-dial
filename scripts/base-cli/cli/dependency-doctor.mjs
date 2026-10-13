import {providerMetadata} from '../modules/dependencies/protocol.mjs';
import {readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
// Canonical local D1, read-only. Diagnostics contain no key, token or metadata body.
export async function localDependencyLinks(root) {
 let directory=root;
 for(const part of ['.wrangler','state','v3','d1','miniflare-D1DatabaseObject']) {
  directory=join(directory,part);const info=await lstat(directory).catch(()=>null);
  if(!info)return [];if(info.isSymbolicLink() || !info.isDirectory())return [{ok:false,status:'unsafe_state'}];
 }
 const {DatabaseSync}=await import('node:sqlite');
 const found=[];
 for(const file of await readdir(directory,{withFileTypes:true})) {
  if(!file.isFile() || !file.name.endsWith('.sqlite'))continue;
  const db=new DatabaseSync(join(directory,file.name),{readOnly:true});
  try {
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='rer_dependency_link'").get())continue;
   for(const row of db.prepare('SELECT interface,issuer,needs_relink FROM rer_dependency_link').all()) {
    found.push(row);
   }
  }finally{db.close();}
 }
 return found;
}

export async function dependencyDoctor(root,{fetch:fetcher=globalThis.fetch}={}) {
 const links=await localDependencyLinks(root),result=[];
 for(const row of links) {
  let status=row.needs_relink?'needs_relink':row.status??'linked';
  if(status==='linked')try{await providerMetadata(row.issuer,fetcher,row.interface);}catch{status='dangling_provider';}
  result.push({interface:row.interface,ok:status==='linked',status});
 }
 return result;
}
