import type { D1ImportContext } from '../../../../modules/import-kit/src/d1/index.ts';

/** A fingerprint describes reviewed values; a completed reversal ends one
 * application of those values. Retries share the next durable application key. */
export async function reviewedApplication(context:D1ImportContext,fingerprint:string):Promise<D1ImportContext>{
 const sql="SELECT count(*) FROM ik_jobs WHERE destination=? AND namespace=? AND mapping_version=? AND principal_id=? AND fingerprint=? AND state IN ('undone','rolled_back')";
 const params=[context.destination,context.namespace,context.mappingVersion,context.authorization.principalId,fingerprint];
 const row=await context.storage.database.prepare(sql.replace('count(*)','count(*) AS generation')).bind(...params).first<{generation:number}>();
 if(!row)throw new Error('Import application history is unavailable.');
 const generation=row.generation;
 return {...context,reviewedFingerprint:fingerprint,operationKey:generation?`${fingerprint}:application:${generation}`:fingerprint,
  authorization:{...context.authorization,predicate(action,destination){
   const authority=context.authorization.predicate(action,destination);
   // Fence a concurrent undo in the same transaction as job creation/replay.
   return {sql:`(${authority.sql}) AND (${sql})=?`,params:[...authority.params??[],...params,generation]};
  }}};
}
