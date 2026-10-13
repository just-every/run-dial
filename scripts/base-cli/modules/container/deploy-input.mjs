import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { refuseLocalModels } from '../deploy-kit/local-only.mjs';
import { LOCAL_ONLY_KEYS, localOnlyBinding } from '../deploy-kit/owner.mjs';
export async function deployInputs({root,envFile,localOnlyKeys=[]}) {
 await refuseLocalModels(root);
 const declaration=JSON.parse(await readFile(join(root,'deploy.json'),'utf8'));
 if(localOnlyBinding(declaration,localOnlyKeys))throw new Error('Deploy declaration contains a local-only binding');
 if(!envFile)throw new Error('Container deploy requires --env-file with private production settings');
 const handle=await open(resolve(root,envFile),constants.O_RDONLY|constants.O_NOFOLLOW);
 let encoded;
 try{const status=await handle.stat();if(!status.isFile()||status.nlink!==1||(status.mode&0o077)!==0||(process.getuid&&status.uid!==process.getuid()))throw new Error('Deploy env file must be an owned private regular file (0600)');encoded=await handle.readFile('utf8');}finally{await handle.close();}
 const settings={};for(const line of encoded.split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw new Error('Invalid deploy env file');if(Object.hasOwn(settings,match[1]))throw new Error('Repeated deploy env key');settings[match[1]]=match[2].replace(/^"(.*)"$/,'$1');}
 if([...LOCAL_ONLY_KEYS,...localOnlyKeys].some(key=>Object.hasOwn(settings,key)))throw new Error('Local-only keys are refused for deploy');
 return{declaration,settings,encoded:Object.entries(settings).map(([key,value])=>key+'='+value).join('\n')+'\n'};
}
