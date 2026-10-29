/** Current native ownership, including explicit API host partitions. */
export function webhookEventHost(event:string) {
 return `COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=${event}),(SELECT id FROM host_profiles WHERE singleton_key='default'))`;
}

/** Queue capture never grants authority after a host or team transfer. */
export function webhookDeliveryScope(alias:string) {
 const event=`COALESCE((SELECT b.event_type_id FROM bookings b WHERE b.id=${alias}.booking_id),
  (SELECT p.event_type_id FROM meeting_polls p WHERE p.id=json_extract(${alias}.body_json,'$.data.pollId')),
  json_extract(${alias}.body_json,'$.data.eventTypeId'))`;
 const routing=`(SELECT r.host_id FROM routing_submissions r WHERE r.id=json_extract(${alias}.body_json,'$.data.submissionId'))`;
 const host=`COALESCE(${routing},${webhookEventHost(event)})`;
 return `EXISTS(SELECT 1 FROM webhook_subscriptions scoped WHERE scoped.id=${alias}.subscription_id AND
  (scoped.scope='workspace' OR scoped.scope='host' AND scoped.scope_id=${host}
   OR scoped.scope='team' AND (EXISTS(SELECT 1 FROM team_event_types t WHERE t.team_id=scoped.scope_id AND t.event_type_id=${event})
    OR ${event} IS NULL AND json_extract(${alias}.body_json,'$.type')='calendar.connection-health-changed.v1'
     AND EXISTS(SELECT 1 FROM teams t WHERE t.id=scoped.scope_id AND t.host_id=${host}))))`;
}
