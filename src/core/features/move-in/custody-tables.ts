import type { Row } from './model';

const additiveColumns:Record<string,string[]>={
 event_schedule_bindings:['event_type_id','schedule_id','created_at','updated_at'],
 booking_limit_policies:['scope','limits_json','created_at','updated_at'],
 event_booking_policies:['event_type_id','locked_timezone','reschedule_cutoff_minutes','cancellation_cutoff_minutes','reschedule_cap','created_at','updated_at'],
 booking_presentation:['booking_id','locked_timezone','browser_timezone','created_at','updated_at'],
 event_correspondence:['event_type_id','templates_json','created_at','updated_at'],
 booking_correspondence:['booking_id','templates_json','created_at','updated_at'],
 booking_reschedule_requests:['id','booking_id','occurrence_id','state','message','release_time','actor_id','archive_historical','created_at','updated_at','expires_at','reminder_at','reminded_at'],
 booking_request_history:['id','booking_id','occurrence_id','action','actor_type','actor_id','reason','created_at'],
 booking_links:['id','event_type_id','kind','overrides_json','expires_at','consumed_at','consumed_booking_id','revoked_at','created_at','updated_at'],
 booking_link_tokens:['id','link_id','token_hash','created_at','updated_at'],
};

// Older retained source snapshots have no additive sidecars. Only empty tables
// may be omitted; every later owner-authored row remains part of exact custody.
export function includeCustodyTable(table:string,rows:Row[]){
 return rows.length>0||table!=='ext_custom_field_values'&&!Object.hasOwn(additiveColumns,table);
}

export function assertCustodyColumns(table:string,rows:Row[]){
 const columns=additiveColumns[table];
 if(columns&&rows.some(row=>Object.keys(row).length!==columns.length||columns.some(column=>!Object.hasOwn(row,column))))throw new Error('Invalid native custody columns.');
}
