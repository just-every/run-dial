import type { D1ImportContext, ImportPlan } from '../../../../modules/import-kit/src/d1/index.ts';

/** Read only the kit's hashed identity index. Equal operators share native data,
 * but another operator's saved plan, originals and job remain private. */
export async function reserveSourceContext(plan:ImportPlan,context:D1ImportContext):Promise<D1ImportContext>{
 const clear={sql:`NOT EXISTS (
  SELECT 1 FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id
  WHERE j.destination=? AND j.namespace=?
   AND i.source_identity IN (SELECT value FROM json_each(?))
   AND (j.state NOT IN ('undone','rolled_back') OR EXISTS (SELECT 1 FROM ik_sources s WHERE s.job_id=j.id))
   AND NOT (j.principal_id=? AND j.fingerprint=? AND j.state NOT IN ('undone','rolled_back'))
 )`,params:[context.destination,context.namespace,JSON.stringify(plan.entries.map(entry=>entry.identity)),plan.principalId,plan.fingerprint]};
 const result=await context.storage.database.prepare(`SELECT ${clear.sql} AS clear`).bind(...clear.params).first<{clear:number}>();
 if(result?.clear!==1)throw new Error('Source records are already saved in an import or retained after undo. No new source copy was saved.');
 return {...context,authorization:{...context.authorization,predicate(action,destination){
  const authority=context.authorization.predicate(action,destination);
  // Job creation checks this before and after its atomic writes, including the
  // identity index, so concurrent operators cannot both save the same source.
  return action==='create'?{sql:`(${authority.sql}) AND (${clear.sql})`,params:[...authority.params??[],...clear.params]}:authority;
 }}};
}
