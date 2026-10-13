import { fixture } from '../archive/fixture.mjs';
import { schemaModel, quote, restoreStatements } from '../../scripts/archive/schema.mjs';
import { exported, excluded } from '../../scripts/archive/policy.mjs';
export const targets = { eventType:'01ARZ3NDEKTSV4RRFFQ69G5FAA',booking:'01ARZ3NDEKTSV4RRFFQ69G5FAB',availabilityRequest:'01ARZ3NDEKTSV4RRFFQ69G5FAC' };
const ids = { 'event_types-1':targets.eventType,'bookings-1':targets.booking,'availability_requests-1':targets.availabilityRequest,'booking_occurrences-1':'01ARZ3NDEKTSV4RRFFQ69G5FAD' };
export async function nativeFixture() {
 const source=await fixture(), destination=await schemaModel();
 try {
  const tables=[...exported,...Object.keys(excluded)].map(name=>({name,rows:source.db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row=>Object.fromEntries(Object.entries(row).map(([column,value])=>[column,typeof value==='string'&&Object.hasOwn(ids,value)?ids[value]:value])))}));
  const triggers=destination.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  destination.db.exec('PRAGMA foreign_keys=ON; BEGIN');
  for(const {sql,params} of restoreStatements(tables,triggers))destination.db.prepare(sql).run(...params);
  destination.db.exec('COMMIT');return destination;
 } catch(error){destination.db.close();throw error;}finally{source.db.close();}
}
