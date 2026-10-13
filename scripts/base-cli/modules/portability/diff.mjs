import { readArchive } from './format.mjs';
import { canonicalJson } from './hash.mjs';
async function inventory(source) {
 const tables = new Map(); let manifest, closing;
 for await (const record of readArchive(source)) {
  if (record.kind === 'manifest') { manifest = record; for (const table of manifest.tables) tables.set(table.name,new Map()); }
  if (record.kind === 'closing') closing = record;
  if (record.kind === 'part') for (const item of record.items) if (item.kind === 'row') {
   const table = manifest.tables.find(table => table.name === item.table);
   const primary = table.columns.filter(column => column.pk).sort((a,b) => a.pk-b.pk).map(column => column.name);
   const key = primary.length ? canonicalJson(primary.map(name => item.row[name])) : table.rowidAlias ? String(item.rowid) : canonicalJson(item.row);
   const rows = tables.get(item.table); if (rows.has(key)) throw new Error('Archive contains duplicate row keys'); rows.set(key,item.row);
  }
 }
 return {manifest,closing,tables};
}
export async function diffArchives(before,after) {
 const [a,b] = await Promise.all([inventory(before),inventory(after)]);
 if (a.manifest.product !== b.manifest.product) throw new Error('Archives describe different products');
 const tables = [];
 for (const name of [...new Set([...a.tables.keys(),...b.tables.keys()])].sort()) {
  const left = a.tables.get(name) ?? new Map(),right = b.tables.get(name) ?? new Map(),added=[],removed=[],changed=[];
  for (const [key,row] of left) { if (!right.has(key)) removed.push(key); else if(canonicalJson(row)!==canonicalJson(right.get(key))) changed.push(key); }
  for (const key of right.keys()) if(!left.has(key))added.push(key);
  if(added.length||removed.length||changed.length)tables.push({name,added,removed,changed});
 }
 const binary = kind => {
  const key = item => canonicalJson(kind==='objects'?[item.bucket,item.key]:[item.name]);
  const left=new Map(a.manifest[kind].map(item=>[key(item),item])),right=new Map(b.manifest[kind].map(item=>[key(item),item]));
  return {added:[...right.keys()].filter(key=>!left.has(key)),removed:[...left.keys()].filter(key=>!right.has(key)),changed:[...left.keys()].filter(key=>right.has(key)&&canonicalJson(left.get(key))!==canonicalJson(right.get(key)))};
 };
 return {equal:a.closing.contentHash===b.closing.contentHash,product:a.manifest.product,schemaChanged:a.manifest.schema!==b.manifest.schema,tables,objects:binary('objects'),payloads:binary('payloads'),configurationChanged:canonicalJson(a.manifest.requiredConfiguration)!==canonicalJson(b.manifest.requiredConfiguration)};
}
