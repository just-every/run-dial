/** Native facts that can change a configuration action's class or its authority.
 * Omit counters and decision locks: admitting another read grants no authority.
 * SQLite evaluates the witness in the same transaction as every native batch.
 */
export const riskWitnessSql = `SELECT json_object(
 'profiles',(SELECT json_group_array(json_array(id,name,updated_at)) FROM (SELECT id,name,updated_at FROM host_profiles ORDER BY id)),
 'events',(SELECT json_group_array(json_array(id,title,status,updated_at)) FROM (SELECT id,title,status,updated_at FROM event_types ORDER BY id)),
 'schedules',(SELECT json_group_array(json_array(id,is_default,updated_at)) FROM (SELECT id,is_default,updated_at FROM availability_schedules ORDER BY id)),
 'bindings',(SELECT json_group_array(json_array(event_type_id,schedule_id)) FROM (SELECT event_type_id,schedule_id FROM event_schedule_bindings ORDER BY event_type_id)),
 'policy',(SELECT json_array(envelope,local_document,local_revision,local_paused) FROM agent_door_state WHERE id=1),
 'agents',(SELECT json_group_array(json_array(id,sponsor,revoked)) FROM (SELECT id,sponsor,revoked FROM agent_door_agents ORDER BY id)),
 'business',(SELECT json_array(owner_id,stopped) FROM bs_settings WHERE singleton=1)
) AS value`;
export async function riskWitness(db: D1Database) {
  const row = await db.prepare(riskWitnessSql).first<{ value: string }>();
  if (!row) throw new Error("Native risk witness unavailable");
  return row.value;
}
