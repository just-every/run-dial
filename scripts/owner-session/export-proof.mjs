import {createHash} from 'node:crypto';
import {must,hash} from './assert.mjs';

// Values enter only through process memory. Failures identify the check, never
// the credential, matching bytes, row contents, or archive body.
export function assertNoSecretValues(archiveBytes,secretValues) {
 const bytes=Buffer.isBuffer(archiveBytes)?archiveBytes:Buffer.from(archiveBytes);
 let checked=0;
 for(const value of new Set(secretValues.filter(value=>typeof value==='string'&&value.length>0))) {
  const representations=[value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value),Buffer.from(value).toString('base64'),Buffer.from(value).toString('base64url')];
  must(representations.every(representation=>!bytes.includes(Buffer.from(representation))),'export-contains-install-secret');checked++;
 }
 must(checked>0,'export-secret-comparison-empty');return {checked,archiveSha256:hash(bytes)};
}
export function canonicalArchive(value) {
 if(Array.isArray(value))return value.map(canonicalArchive);
 if(JSON.isRawJSON(value))return value;
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalArchive(value[key])]));
 return value;
}
export function equivalentArchive(left,right,{volatileKeys=[]}={}) {
 // Only fields explicitly documented as export metadata may be omitted. Record
 // order and every exported byte remain significant unless native comparison
 // defines otherwise; no credential or application field is silently removed.
 const normalized=value=>{const copy={...value};for(const key of volatileKeys){must(['exportedAt','createdAt'].includes(key),'export-comparison-field-not-metadata');delete copy[key];}return canonicalArchive(copy);};
 must(JSON.stringify(normalized(left))===JSON.stringify(normalized(right)),'export-round-trip-different');return true;
}

// Compare in bounded chunks so object bytes do not become one large JS string.
export async function inspectArchiveSecrets(chunks,values) {
 const secrets=[...new Set(values.filter(value=>typeof value==='string'&&value.length>0))];
 must(secrets.length>0,'export-secret-comparison-empty');
 const needles=[...new Set(secrets.flatMap(value=>[value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value),Buffer.from(value).toString('base64'),Buffer.from(value).toString('base64url')]))].map(value=>Buffer.from(value));
 const overlap=Math.max(...needles.map(value=>value.length))-1,hash=createHash('sha256');let tail=Buffer.alloc(0),bytes=0;
 for await(const chunk of chunks) {hash.update(chunk);bytes+=chunk.length;const combined=Buffer.concat([tail,chunk]);must(needles.every(value=>!combined.includes(value)),'export-contains-install-secret');tail=combined.subarray(Math.max(0,combined.length-overlap));}
 return {checked:secrets.length,bytes,archiveSha256:hash.digest('hex')};
}
