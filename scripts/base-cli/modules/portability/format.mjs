import { archiveLines } from './lines.mjs';
import { canonicalJson, sha256, StreamHash, unbase64, utf8 } from './hash.mjs';
import { insist } from './storage.mjs';
import { validateRow } from './catalogue.mjs';
export const FORMAT='runeditrun-portability';
export const MAX_LINE_BYTES=24*1024*1024;
export const MAX_PART_BYTES=16*1024*1024;
export async function makePart(index,items) {
  const content={kind:'part',index,items}; return {...content,sha256:await sha256(canonicalJson(content))};
}
export async function checkPart(part,index,partBytes=MAX_PART_BYTES) {
  insist(part?.kind==='part' && part.index===index && Array.isArray(part.items) && part.items.length>0 && Object.keys(part).sort().join(',')==='index,items,kind,sha256','part_order');
  insist(Number.isSafeInteger(partBytes) && partBytes>0 && partBytes<=MAX_PART_BYTES,'invalid_part_limit');
  insist(utf8(canonicalJson(part)).length<=partBytes,'part_byte_limit',413);
  insist(part.sha256===await sha256(canonicalJson({kind:part.kind,index:part.index,items:part.items})),'part_checksum');
  insist(part.items.filter(x=>x.kind==='row').length<=1000,'part_row_limit');
}
export async function checkManifest(m) {
  insist(m?.kind==='manifest' && m.format===FORMAT,'archive_format');
  // Version 1 never authenticated restoration identity or erasure metadata.
  // Relabelling it cannot recover the missing binding.
  insist(m.version!==1,'legacy_archive_unverifiable',409);
  insist(m.version===2,'archive_format');
  await checkManifestFields(m);
}
async function checkLegacyManifest(m) {
  insist(m?.kind==='manifest' && m.format===FORMAT && m.version===1,'legacy_v1_required',409);
  await checkManifestFields(m);
  insist(m.journal.every(x=>typeof x==='string' && /^[a-f0-9]{64}$/.test(x)),'invalid_journal');
}
async function checkManifestFields(m) {
  insist(typeof m.product==='string' && typeof m.sourceIdentity==='string' && typeof m.exportedAt==='string','manifest_identity');
  insist(Number.isSafeInteger(m.partCount) && m.partCount>=0 && Number.isSafeInteger(m.epoch) && m.epoch>=0,'manifest_counts');
  insist(Array.isArray(m.tables) && Array.isArray(m.objects) && Array.isArray(m.payloads) && Array.isArray(m.journal) && Array.isArray(m.requiredConfiguration),'manifest_inventory');
  // Applied product migrations, recorded by archives since additive restore.
  insist(m.migrations===undefined || (Array.isArray(m.migrations) && m.migrations.every(x=>typeof x==='string')),'manifest_inventory');
  insist(m.schema===await sha256(canonicalJson(m.tables.map(({name,sql})=>({name,sql})))),'schema_checksum');
  insist(m.tables.every((t,i)=>typeof t.name==='string' && typeof t.sql==='string' && Array.isArray(t.columns) && Array.isArray(t.dependencies) && Number.isSafeInteger(t.count) && t.count>=0 && (!i || m.tables[i-1].name<t.name)),'table_inventory');
  for(const collection of [m.objects,m.payloads]) {
    const keys=new Set();
    for(const entry of collection) {
      const key=entry.bucket===undefined?entry.name:canonicalJson([entry.bucket,entry.key]);
      insist(typeof key==='string' && !keys.has(key) && Number.isSafeInteger(entry.size) && entry.size>=0 && /^[a-f0-9]{64}$/.test(entry.sha256),'binary_inventory'); keys.add(key);
    }
  }
}
// Bind the entire manifest, including future policy-visible fields, and every
// ordered part digest. Part checksums cover all row/object/payload fields.
// contentHash remains independent of export time, identity and part boundaries.
export class ArchiveVerifier {
  constructor(manifest) {
    this.hash=new StreamHash().update('{"manifest":'+canonicalJson(manifest)+',"parts":[');
    this.count=0;
  }
  add(part) {
    if(this.count++)this.hash.update(',');
    this.hash.update(canonicalJson(part.sha256));
  }
  digest() { return this.hash.update(']}').digest(); }
}
export class ContentVerifier {
  constructor(manifest) {
    this.manifest=manifest; this.hash=new StreamHash(); this.table=0; this.row=0; this.binary=0; this.offset=0; this.binaryHash=new StreamHash();
    this.entries=[...manifest.objects.map(x=>({...x,kind:'object'})),...manifest.payloads.map(x=>({...x,kind:'payload'}))];
    const objects=manifest.objects.map(({bucket,key,size,sha256,httpMetadata,customMetadata})=>({bucket,key,size,sha256,metadata:{httpMetadata,customMetadata}}));
    this.hash.update('{"objects":'+canonicalJson(objects)+',"payloads":'+canonicalJson(manifest.payloads)+',"requiredConfiguration":'+canonicalJson(manifest.requiredConfiguration)+',"schema":'+canonicalJson(manifest.schema)+',"tables":[');
    this.open=false; this.rows=0;
  }
  emptyTables() {
    while(this.table<this.manifest.tables.length) {
      const t=this.manifest.tables[this.table];
      if(!this.open) {if(this.table)this.hash.update(',');this.hash.update('{"name":'+canonicalJson(t.name)+',"rows":[');this.open=true;}
      if(this.row<t.count) break;
      this.hash.update(']}');this.table++;this.row=0;this.open=false;
    }
  }
  add(item) {
    this.emptyTables();
    if(item.kind==='row') {
      const t=this.manifest.tables[this.table];
      insist(t && item.table===t.name && item.index===this.row,'row_order');
      validateRow(t,item.row,this.manifest.excludedColumns[t.name]??[]);
      if(t.rowidAlias)insist(Number.isSafeInteger(item.rowid),'rowid_inventory');
      if(this.row)this.hash.update(',');this.hash.update(canonicalJson(item.row));this.row++;this.rows++;return;
    }
    insist(this.table===this.manifest.tables.length,'rows_missing');
    const entry=this.entries[this.binary];
    insist(entry && item.kind===entry.kind && (entry.kind==='object'?item.bucket===entry.bucket && item.key===entry.key:item.name===entry.name) && item.offset===this.offset,'binary_order');
    const bytes=unbase64(item.data); insist(this.offset+bytes.length<=entry.size && (bytes.length>0 || entry.size===0),'binary_size');
    this.binaryHash.update(bytes);this.offset+=bytes.length;
    if(this.offset===entry.size) {insist(this.binaryHash.digest()===entry.sha256,'binary_checksum');this.binary++;this.offset=0;this.binaryHash=new StreamHash();}
  }
  digest() {
    this.emptyTables();insist(this.table===this.manifest.tables.length && this.binary===this.entries.length,'archive_incomplete');
    return this.hash.update(']}').digest();
  }
}
export async function* readArchive(source,{maxLineBytes=MAX_LINE_BYTES,partBytes=MAX_PART_BYTES}={}) {
  yield* verifiedRecords(source,maxLineBytes,partBytes,checkManifest,true);
}
// Deliberately separate from the normal reader: only the acknowledged local
// recovery path uses this. It cannot establish the missing manifest binding.
export async function* readLegacyArchive(source,{maxLineBytes=MAX_LINE_BYTES,partBytes=MAX_PART_BYTES}={}) {
  yield* verifiedRecords(source,maxLineBytes,partBytes,checkLegacyManifest,false);
}
async function* verifiedRecords(source,maxLineBytes,partBytes,validateManifest,requireBinding) {
  let manifest,verifier,archive,index=0,closed=false;
  for await(const line of archiveLines(source,maxLineBytes)) {
    insist(!closed,'data_after_closing');
    let record;try{record=JSON.parse(line);}catch{throw new Error('archive_json');}
    if(!manifest) {await validateManifest(record);manifest=record;verifier=new ContentVerifier(manifest);archive=new ArchiveVerifier(manifest);yield record;continue;}
    if(record.kind==='closing') {
      insist(index===manifest.partCount && record.partCount===index,'part_count');
      insist(record.contentHash===verifier.digest(),'content_checksum');
      if(requireBinding)insist(record.archiveHash===archive.digest(),'archive_checksum',409);closed=true;yield record;continue;
    }
    insist(index<manifest.partCount,'extra_part');await checkPart(record,index++,partBytes);
    archive.add(record);
    for(const item of record.items)verifier.add(item);yield record;
  }
  insist(closed,'closing_missing');
}
