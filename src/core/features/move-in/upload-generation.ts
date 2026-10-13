import type { D1ImportContext } from '../../../../modules/import-kit/src/d1/index.ts';

// An undo ends an upload's application lifetime, including unapplied identities
// minted before that undo. Fence the same fact inside atomic job creation.
const ended = "SELECT count(*) FROM ik_jobs WHERE destination='dial' AND principal_id=? AND state IN ('undone','rolled_back')";
export async function uploadGeneration(context:D1ImportContext){
 const row=await context.storage.database.prepare(ended.replace('count(*)','count(*) AS generation')).bind(context.authorization.principalId).first<{generation:number}>();
 if(!row)throw new Error('Upload application history is unavailable.');
 return row.generation;
}
export function fenceUploadGeneration(context:D1ImportContext,generation:number):D1ImportContext{
 return {...context,authorization:{...context.authorization,predicate(action,destination){
  const authority=context.authorization.predicate(action,destination);
  return {sql:`(${authority.sql}) AND (${ended})=?`,params:[...authority.params??[],context.authorization.principalId,generation]};
 }}};
}
