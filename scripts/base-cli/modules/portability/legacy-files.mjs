import { lstat } from 'node:fs/promises';
import { policy } from './catalogue.mjs';
import { createPortability } from './index.mjs';
import { createImport, uploadPart, finalizeImport, abortImport } from './import.mjs';
import { readLegacyArchive, ArchiveVerifier } from './format.mjs';
import { fileRecords, exportArchive } from './files.mjs';
import { ensureLegacyAudit, legacyTargetState, requireLegacyEmpty } from './legacy-safety.mjs';
import { insist, PortabilityError } from './storage.mjs';

export async function recoverLegacyArchive({db,buckets,policy:input,migrations},path,output,transient,acknowledged) {
 insist(acknowledged===true,'legacy_acknowledgement_required',409);
 insist(typeof output==='string' && output!==path,'legacy_output_required',409);
 insist(!(await lstat(output).catch(error=>{if(error.code==='ENOENT')return null;throw error;})),'legacy_output_exists',409);
 // Whole-file verification precedes even staging/audit schema writes.
 for await(const record of fileRecords(path,readLegacyArchive)){}
 const context={db,buckets,config:policy(input),migrations},target=await legacyTargetState(db,migrations);
 await requireLegacyEmpty(context,target);
 let id,manifest,closing,integrity,status,complete=false;
 try {
  for await(const record of fileRecords(path,readLegacyArchive)) {
   if(record.kind==='manifest') {
    // This is a local staging envelope, never an assertion of v1 provenance.
    // Normal import/finalize retain their v2 checks and erasure fence.
    manifest={...record,version:2};integrity=new ArchiveVerifier(manifest);
    id=await createImport(context,manifest,'legacy-v1',{
     event:'legacy_v1_unverified_restore',acknowledgedUnverifiedMetadata:true,
     sourceIdentity:record.sourceIdentity,exportedAt:record.exportedAt,
     recoveryOutput:output,...target,
    });
    // A refused schema writes nothing, not even the audit table.
    await ensureLegacyAudit(db);
   }else if(record.kind==='part') {integrity.add(record);await uploadPart(context,id,record.index,record);}
   else closing=record;
  }
  status=await finalizeImport(context,id,{contentHash:closing.contentHash,archiveHash:integrity.digest()});complete=true;
 }finally{if(id&&!complete)await abortImport(context,id);}
 // A fresh export binds the recovered installation from this point forward.
 // A failure here must be reported; the durable restore audit remains intact.
 try {
  const recovered=await exportArchive(await createPortability({db,buckets,policy:input}),output,transient);
  return {...recovered,legacyRecovery:true,unverifiedMetadata:true,restoredContentHash:closing.contentHash,...(status.bridged?{bridged:status.bridged}:{})};
 }catch{throw new PortabilityError('legacy_restored_export_failed',500);}
}
