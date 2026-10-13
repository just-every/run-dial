import { sourceIdentity } from '../../../../modules/import-kit/src/provenance/identity.ts';
import { namespace, type SourceData } from './source';

export const destination='dial';
export const identityOf=(kind:'profile'|'event'|'booking',sourceId:string)=>sourceIdentity(destination,namespace,kind,sourceId);
export type CaptureMode={mode:'first'}|{mode:'catch-up';known:Set<string>};

/** A capture of the same source user as an applied import is a catch-up: every
 * record already saved there is matched by its source identity and left alone.
 * Reads only the kit's hashed identity index, never another operator's plan. */
export async function captureMode(db:D1Database,data:SourceData):Promise<CaptureMode>{
 const live=(await db.prepare("SELECT state FROM ik_jobs WHERE destination=? AND namespace=? AND state NOT IN ('undone','rolled_back')").bind(destination,namespace).all<{state:string}>()).results;
 if(!live.length)return {mode:'first'};
 const profile=identityOf('profile',data.user[0].uri);
 const candidates=[profile,...data.event_types.map(e=>identityOf('event',e.uri)),...data.scheduled_events.map(e=>identityOf('booking',e.uri))];
 const rows=(await db.prepare("SELECT DISTINCT i.source_identity AS identity FROM ik_d1_plan_index i JOIN ik_jobs j ON j.id=i.job_id WHERE j.destination=? AND j.namespace=? AND j.state NOT IN ('undone','rolled_back') AND i.source_identity IN (SELECT value FROM json_each(?))").bind(destination,namespace,JSON.stringify(candidates)).all<{identity:string}>()).results;
 if(!rows.some(row=>row.identity===profile))throw new Error(`This capture is from a different source account (${data.user[0].slug}) than the saved import. Catch up only with a newer capture of the same account. Nothing was saved.`);
 if(live.some(job=>job.state!=='completed'))throw new Error('Source records are already saved in an import that has not finished. Finish or undo it before catching up. Nothing was saved.');
 return {mode:'catch-up',known:new Set(rows.map(row=>row.identity))};
}
