import type { D1TargetAdapter, D1Database, D1Sql, TargetRow, D1UndoEffect, D1UndoDependency } from '../../../../modules/import-kit/src/d1/index.ts';
import { insertJsonRows } from '../../../../modules/import-kit/src/d1/sets.ts';
import { canonicalJson, sha256 } from '../../../../modules/import-kit/src/provenance/identity.ts';
import { json, type NativeValue, type Row } from './model';
import { conjunction } from './native-predicates';
import { assertCustodyColumns, includeCustodyTable } from './custody-tables';
const groups:Record<string,Record<string,string>>={
 profile:{host_profiles:'id',profile_focus_areas:'profile_id',social_proof_entries:'profile_id'},
 event:{event_types:'id',ext_custom_field_values:'event_type_id',event_questions:'event_type_id',recurring_availability_windows:'event_type_id',availability_date_overrides:'event_type_id',availability_date_override_windows:'override_id IN (SELECT id FROM availability_date_overrides WHERE event_type_id',event_schedule_bindings:'event_type_id',booking_limit_policies:'scope',event_booking_policies:'event_type_id',event_correspondence:'event_type_id',booking_links:'event_type_id',booking_link_tokens:'link_id IN (SELECT id FROM booking_links WHERE event_type_id'},
 booking:{bookings:'id',ext_custom_field_values:'booking_id',booking_occurrences:'booking_id',booking_answers:'booking_id',booking_manage_tokens:'booking_id',booking_history:'booking_id',booking_attendance:'booking_id',booking_calendar_conflicts:'booking_id',booking_presentation:'booking_id',booking_correspondence:'booking_id',booking_reschedule_requests:'booking_id',booking_request_history:'booking_id',booking_links:'consumed_booking_id',booking_link_tokens:'link_id IN (SELECT id FROM booking_links WHERE consumed_booking_id'},
};
const parentTables:Record<string,{table:string;foreign:string}>={availability_date_override_windows:{table:'availability_date_overrides',foreign:'override_id'},booking_link_tokens:{table:'booking_links',foreign:'link_id'}};
function scope(kind:string,table:string){const key=groups[kind]?.[table];if(!key)throw new Error('Unsupported import native table.');return key.includes(' IN ')?`${key}=?)`:`${key}=?`;}
// Search columns are a deterministic projection, not source-owned content.
// Keep old applied snapshots and undo guards comparable after the additive upgrade.
function sourceRows(table:string,rows:Row[]){
 if(table==='bookings')return rows.map(row=>{const source={...row};delete source.invitee_name_folded;delete source.invitee_email_folded;return source;});
 // Saved source profiles have no avatar. Absent additive defaults are not an
 // authored change, while a later uploaded avatar remains visible to undo.
 if(table==='host_profiles')return rows.map(row=>{if(row.avatar_key!==null||row.avatar_content_type!==null)return row;const source={...row};delete source.avatar_key;delete source.avatar_content_type;return source;});
 return rows;
}
function value(row:TargetRow){return row.value as unknown as NativeValue;}
// Migration 0042 gives historical bookings a calendar obligation of 1. Recover
// the old representation only when its COMPLETE value matches retained custody;
// explicitly authored 0/1 and every later native edit keep their actual values.
function snapshot(tables:NativeValue['tables'],appliedHash:string|null){
 // Additive defaults belong to the historical representation only when the
 // complete retained snapshot proves that representation. Authored edits stay visible.
 const eventTables=tables.event_types?.every(row=>row.booking_horizon_mode==='calendar_days'&&row.booking_start_date===null&&row.booking_end_date===null)
  ? {...tables,event_types:tables.event_types.map(row=>{const source={...row};delete source.booking_horizon_mode;delete source.booking_start_date;delete source.booking_end_date;return source;})}:null;
 const eventVersions:NativeValue['tables'][]=[tables,...(eventTables?[eventTables]:[])];
 for(const candidate of [...eventVersions])if(candidate.event_types?.every(row=>row.duration_options_json===JSON.stringify([row.duration_minutes])))eventVersions.push({...candidate,event_types:candidate.event_types.map(row=>{const source={...row};delete source.duration_options_json;return source;})});
 // Migration 0054's empty link context is absent from retained source snapshots.
 // Try the prior shape only; the full custody hash below must prove the match.
 for(const candidate of [...eventVersions]){
  const defaults:Record<string,Record<string,unknown>>={event_types:{post_booking_redirect_json:null},event_questions:{private:0},bookings:{attribution_json:'{}',post_booking_redirect_url:null}};
  const historical={...candidate};let changed=false;
  for(const [table,columns]of Object.entries(defaults))if(candidate[table]?.every(row=>Object.entries(columns).every(([key,value])=>row[key]===value))){historical[table]=candidate[table].map(row=>{const source={...row};for(const key of Object.keys(columns))delete source[key];return source;});changed=true;}
  if(changed)eventVersions.push(historical);
 }
 // 0058 and 0060 add physical defaults to SELECT *; omit each only when
 // unchanged, and only accept the complete retained source hash below.
 for(const [table,column,defaultValue] of [['event_types','locations_json',null],['booking_occurrences','blocks_time',1]] as const){
  for(const candidate of [...eventVersions])if(candidate[table]?.length&&candidate[table].every(row=>row[column]===defaultValue))eventVersions.push({...candidate,[table]:candidate[table].map(row=>{const source={...row};delete source[column];return source;})});
 }
 for(const candidate of eventVersions){
  const historical=candidate.bookings?.some(row=>row.calendar_required===1)
   ? {...candidate,bookings:candidate.bookings.map(row=>{const source={...row};if(source.calendar_required===1)delete source.calendar_required;return source;})}:null;
  for(const version of [candidate,...(historical?[historical]:[])]){const value=json({tables:version});if(sha256(canonicalJson(value))===appliedHash)return value;}
 }
 return json({tables});
}
type Marker={kind:string;id:string;revision:string;valueHash:string|null};
const markersSql=`SELECT m.kind,m.id,m.revision,json_extract(p.record_json,'$.valueHash') AS valueHash FROM move_in_targets m LEFT JOIN ik_provenance p ON p.destination=? AND p.target_kind=m.kind AND p.target_id=m.id AND p.reversed=0 AND json_extract(p.record_json,'$.appliedRevision')=m.revision`;
function exact(table:string,where:string,id:string,rows:Row[]):D1Sql{
 assertCustodyColumns(table,rows);
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];if(columns.some(key=>!/^\w+$/u.test(key)))throw new Error('Invalid native column.');
 const predicates=columns.map(key=>`actual.${key} IS json_extract(wanted.value,'$.${key}')`);
 // Missing means the historical default, never an unguarded column. Keep the
 // predicate per row so mixed old and explicit snapshots have exact semantics.
 if(table==='bookings'){
  const index=columns.indexOf('calendar_required');if(index!==-1)predicates.splice(index,1);
  predicates.push(`actual.calendar_required IS CASE WHEN json_type(wanted.value,'$.calendar_required') IS NULL THEN 1 ELSE json_extract(wanted.value,'$.calendar_required') END`);
  if(!columns.includes('attribution_json'))predicates.push("actual.attribution_json IS '{}'");
  if(!columns.includes('post_booking_redirect_url'))predicates.push('actual.post_booking_redirect_url IS NULL');
 }
 if(table==='event_types'){
  if(!columns.includes('duration_options_json'))predicates.push("actual.duration_options_json IS json_array(actual.duration_minutes)");
  if(!columns.includes('booking_horizon_mode'))predicates.push("actual.booking_horizon_mode IS 'calendar_days'");
  for(const key of ['booking_start_date','booking_end_date'])if(!columns.includes(key))predicates.push(`actual.${key} IS NULL`);
  if(!columns.includes('post_booking_redirect_json'))predicates.push('actual.post_booking_redirect_json IS NULL');
  if(!columns.includes('locations_json'))predicates.push('actual.locations_json IS NULL');
 }
 if(table==='booking_occurrences'){
  const index=columns.indexOf('blocks_time');if(index!==-1)predicates.splice(index,1);
  predicates.push("actual.blocks_time IS CASE WHEN json_type(wanted.value,'$.blocks_time') IS NULL THEN 1 ELSE json_extract(wanted.value,'$.blocks_time') END");
 }
 if(table==='event_questions'&&!columns.includes('private'))predicates.push('actual.private IS 0');
 if(table==='host_profiles')for(const key of ['avatar_key','avatar_content_type'])if(!columns.includes(key))predicates.push(`actual.${key} IS NULL`);
 return {sql:`(SELECT count(*) FROM ${table} WHERE ${where})=? AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM ${table} actual WHERE ${conjunction(predicates)}))`,params:[id,rows.length,JSON.stringify(rows)]};
}
export const importTargets:D1TargetAdapter={
 async read(db,destination,kind,id){
  const marker=await db.prepare(`${markersSql} WHERE m.kind=? AND m.id=?`).bind(destination,kind,id).first<Marker>();
  if(!marker)return undefined;
  const tables:NativeValue['tables']={};for(const table of Object.keys(groups[kind]??{})){const {results}=await db.prepare(`SELECT * FROM ${table} WHERE ${scope(kind,table)} ORDER BY rowid`).bind(id).all<Row>();if(includeCustodyTable(table,results))tables[table]=sourceRows(table,results);}
  return {destination,targetKind:kind,targetId:id,value:snapshot(tables,marker.valueHash),revision:marker.revision};
 },
 matches(row,destination,kind,id){const parts=this.matchesParts!(row,destination,kind,id);return {sql:conjunction(parts.map(part=>part.sql)),params:parts.flatMap(part=>part.params??[])};},
 matchesParts(row,_destination,kind,id){
  const parts:D1Sql[]=[{sql:row?'EXISTS(SELECT 1 FROM move_in_targets WHERE kind=? AND id=? AND revision=?)':'NOT EXISTS(SELECT 1 FROM move_in_targets WHERE kind=? AND id=?)',params:row?[kind,id,row.revision]:[kind,id]}];
  for(const table of Object.keys(groups[kind]??{}))parts.push(exact(table,scope(kind,table),id,row?value(row).tables[table]??[]:[]));
  return parts;
 },
 write(row){
  const statements:D1Sql[]=[];
  for(const table of Object.keys(groups[row.targetKind]??{})){
   const records=value(row).tables[table]??[];if(!records.length)continue;
   assertCustodyColumns(table,records);
   const keys=Object.keys(records[0]);
   if(keys.some(key=>!/^\w+$/u.test(key))||records.some(record=>Object.keys(record).length!==keys.length||keys.some(key=>!(key in record))))throw new Error('Invalid native columns.');
   // A source entity can own hundreds of windows. Bound SQL expansion by
   // JSON byte chunks, retaining the kit's same atomic native row guards.
   statements.push(...insertJsonRows(table,keys,records));
  }
  if(row.targetKind==='booking'){
   const booking=value(row).tables.bookings[0],occurrence=value(row).tables.booking_occurrences[0];
   // Fail the complete atomic kit batch if another native confirmation won after preview.
   statements.unshift({sql:`INSERT INTO move_in_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM booking_occurrences o JOIN bookings b ON b.id=o.booking_id WHERE o.is_current=1 AND o.blocks_time=1 AND b.state IN ('confirmed','rescheduled') AND o.occupied_start_at<? AND o.occupied_end_at>?) AND EXISTS(SELECT 1 FROM event_types WHERE id=?) THEN 1 ELSE 0 END`,params:[occurrence.occupied_end_at,occurrence.occupied_start_at,booking.event_type_id]});
   statements.push({sql:'DELETE FROM move_in_guard'});
  }
  statements.push({sql:'INSERT INTO move_in_targets(kind,id,revision) VALUES(?,?,?)',params:[row.targetKind,row.targetId,row.revision]});return statements;
 },
 remove(_destination,kind,id){return [{sql:`DELETE FROM ${Object.keys(groups[kind])[0]} WHERE id=?`,params:[id]},{sql:'DELETE FROM move_in_targets WHERE kind=? AND id=?',params:[kind,id]}];},
 async list(db,destination){
  const markers=(await db.prepare(`${markersSql} ORDER BY m.kind,m.id`).bind(destination).all<Marker>()).results;
  const sets=new Map<string,Row[]>();
  for(const [kind,tables]of Object.entries(groups))for(const [table,key]of Object.entries(tables)){
   const where=key.includes(' IN ')?`${key} IN(SELECT id FROM move_in_targets WHERE kind='${kind}'))`:`${key} IN(SELECT id FROM move_in_targets WHERE kind='${kind}')`;
   sets.set(`${kind}:${table}`,sourceRows(table,(await db.prepare(`SELECT * FROM ${table} WHERE ${where} ORDER BY rowid`).all<Row>()).results));
  }
  return markers.map(marker=>{const tables:NativeValue['tables']={};for(const [table,key]of Object.entries(groups[marker.kind])){const rows=(sets.get(`${marker.kind}:${table}`)??[]).filter(row=>parentTables[table]?(sets.get(`${marker.kind}:${parentTables[table].table}`)??[]).some(parent=>parent.id===row[parentTables[table].foreign]&&parent[groups[marker.kind][parentTables[table].table]]===marker.id):row[key]===marker.id);if(includeCustodyTable(table,rows))tables[table]=rows;}return {destination,targetKind:marker.kind,targetId:marker.id,revision:marker.revision,value:snapshot(tables,marker.valueHash)};});
 },
 matchesCount(count){return {sql:'(SELECT count(*) FROM move_in_targets)=?',params:[count]};},
 // A native value is {tables}: a selector outside `tables` (an invitee inside a
 // retained source payload) can hold no native leaf, so field redaction reads
 // and rewrites no native row. Dial selects no native columns by path.
 async redaction(_db,_destination,fields){
  if(fields.some(field=>field.path[0]==='tables'))throw new Error('Native field redaction is not supported.');
  return {rows:[],holding:()=>[],matches:()=>[],write:()=>[]};
 },
 async preparePreservedUndo(db:D1Database,destination:string,effects:D1UndoEffect[]){
  const observations=[],dependencies:D1UndoDependency[]=[],guards:D1Sql[]=[];
  for(const effect of effects){const {targetKind:kind,targetId:id}=effect.expected;const current=await this.read(db,destination,kind,id);observations.push({effectId:effect.provenance.id,current:current??null,entity:{table:Object.keys(groups[kind])[0],recordId:id}});guards.push(...this.matchesParts!(current??null,destination,kind,id));
   if(kind==='event'){
    const rows=(await db.prepare('SELECT id FROM bookings WHERE event_type_id=? ORDER BY id').bind(id).all<{id:string}>()).results;
    guards.push({sql:'(SELECT json_group_array(id) FROM (SELECT id FROM bookings WHERE event_type_id=? ORDER BY id))=?',params:[id,JSON.stringify(rows.map(r=>r.id))]});
    for(const booking of rows){const related=effects.find(e=>e.expected.targetKind==='booking'&&e.expected.targetId===booking.id);dependencies.push({requiredEffectId:effect.provenance.id,...(related?{dependentEffectId:related.provenance.id}:{}),cause:{table:'bookings',recordId:booking.id},evidence:json({reason:'Event has a booking.'})});}
   }
   if(kind==='profile'){
    const rows=(await db.prepare('SELECT id FROM event_types ORDER BY id').all<{id:string}>()).results;guards.push({sql:'(SELECT json_group_array(id) FROM (SELECT id FROM event_types ORDER BY id))=?',params:[JSON.stringify(rows.map(r=>r.id))]});
    for(const event of rows){const related=effects.find(e=>e.expected.targetKind==='event'&&e.expected.targetId===event.id);dependencies.push({requiredEffectId:effect.provenance.id,...(related?{dependentEffectId:related.provenance.id}:{}),cause:{table:'event_types',recordId:event.id},evidence:json({reason:'Host has an event type.'})});}
   }
  }
  return {observations,dependencies,guards:guards.length?guards:[{sql:'(SELECT count(*) FROM move_in_targets)>=0'}]};
 },
};
