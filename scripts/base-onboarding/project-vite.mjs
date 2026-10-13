import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

// The project's own vite entry file, so `dev` runs node on it directly instead
// of through `pnpm exec`, which keeps a 50-100 MB wrapper process alive for the
// whole session.
export function projectViteBinary(root){
 let manifest;
 try{manifest=createRequire(join(resolve(root),'package.json')).resolve('vite/package.json');}
 catch{throw new Error('The project\'s vite is not installed. Run rer install first.');}
 const bin=JSON.parse(readFileSync(manifest,'utf8')).bin;
 return join(dirname(manifest),typeof bin==='string'?bin:bin.vite);
}
