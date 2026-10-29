import { foldBookingSearch } from '../../src/core/features/bookings/search/case-fold.mjs';
import { importExported } from './import-policy.mjs';
import { scrub } from './redaction.mjs';
import { parseJsonText } from './json-values.mjs';
export { scrub, collectSecrets } from './redaction.mjs';
// Exhaustive application-table policy. Unknown tables stop export and restore.
// operator_setup_identity retains its durable first-run timestamp, including NULL.
export const exported = [
  ...importExported,
  "api_credentials", "api_oauth_applications", "workflow_rules",
  "teams", "team_event_types", "routing_forms", "routing_submissions", "webhook_subscriptions", "webhook_deliveries",
  "analytics_settings", "analytics_connections", "analytics_deliveries",
  'rer_erasure_operations', 'person_erasure_receipts', 'processor_erasure_requests', 'operator_erasure_subjects',
  'ext_custom_field_definitions', 'ext_custom_field_values',
  'avatar_object_deletions', 'operators', 'host_profiles', 'host_link_copy_reports', 'profile_focus_areas', 'social_proof_entries', 'event_types',
  'event_questions', 'recurring_availability_windows', 'availability_date_overrides',
  'availability_schedules', 'event_schedule_bindings', 'booking_limit_policies', 'event_booking_policies', 'event_correspondence',
  'availability_date_override_windows', 'calendar_connections', 'calendar_connection_calendars', 'calendar_connection_health_changes',
  'provider_connection_health', 'calendar_busy_intervals', 'calendar_busy_read_windows',
  'delivery_outbox', 'delivery_attempts', 'provider_webhook_events', 'operator_delivery_preferences',
  'bookings', 'booking_approval_requests', 'booking_guests', 'booking_occurrences', 'booking_answers', 'booking_history', 'booking_request_history', 'booking_reschedule_requests', 'booking_attendance', 'booking_presentation', 'booking_correspondence',
  'blocked_address_rules', 'availability_requests', 'availability_request_windows', 'embed_allowed_origins',
  'meeting_polls', 'poll_candidates', 'poll_participants', 'poll_votes',
  'client_profiles', 'client_aliases', 'client_notes', 'client_fields',
  'booking_calendar_conflicts', 'booking_links', 'anonymized_audit', 'erased_calendar_targets', 'calendar_deletion_probes',
  'oc_owner_claims', 'operator_setup_identity', 'operator_mail_invocations', 'oa_operators', 'oa_bootstrap', 'base_mail_dispatch',
  'operator_creation_receipts', 'operator_creation_tombstones', 'oa_invitation_cancellations', 'oa_domain_rules',
  // PAY-001: the connected Stripe account ID (no credential), event prices and each booking's payment record.
  'payment_connections', 'event_type_prices', 'booking_payments',
  // PAY-003: event payment terms, each booking's terms snapshot, card consent (Stripe references, never card data)
  // and money movements.
  'event_type_payment_terms', 'booking_payment_terms', 'booking_card_consents', 'payment_movements',
  // PAY-005: Stripe Tax on or off and the business name on receipts and invoices.
  'workspace_notice_destinations','workspace_notice_deliveries','notice_erasure_requests',
  'payment_settings', 'payment_processor_facts', 'accounting_connections', 'accounting_exports',
  // BRAND-001: the workspace's look read from its website; its read mark travels as an R2 brand/ file.
  'site_looks',
].sort();
export { excluded } from "../../src/core/shared/archive-exclusions.mjs";
import { excluded } from "../../src/core/shared/archive-exclusions.mjs";
export const internal = {
  booking_search_casefold: 'Normative Unicode folding data installed by the destination migration; contains no owner data',
  _rer_deploy_migrations: 'Installer-only migration claims and hashes; retain destination history instead of archiving it',
  d1_migrations: 'Installer migration ledger', sqlite_sequence: 'SQLite sequence bookkeeping',
  rer_migrations: 'Run Edit Run Platform migration ledger (names and file hashes); validated against the schema proof and kept on the destination instead of archiving it',
  sqlite_stat1: 'SQLite query planner statistics', sqlite_stat4: 'SQLite query planner samples',
};
export function isInternalTable(name) {
  return Object.hasOwn(internal, name) || name.startsWith('_cf_') || name.startsWith('rer_portability_');
}
export function assertCoverage(names) {
  const application = names.filter(name => !isInternalTable(name)).sort();
  const classified = [...exported, ...Object.keys(excluded)].sort();
  if (JSON.stringify(application) !== JSON.stringify(classified)) throw new Error('archive-unclassified-schema');
}
export function canonicalRow(name, source, secrets = []) {
  const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, scrub(value, secrets, name === 'delivery_outbox' && key === 'payload_json')]));
  if (name === 'workflow_rules') { row.enabled = 0; row.enabled_at = null; }
  if (name === 'api_credentials') { row.secret_hash = null; row.revoked_at ??= row.updated_at; }
  if (name === 'api_oauth_applications') { row.client_secret_hash = null; row.revoked_at ??= row.updated_at; }
  if (name === 'webhook_subscriptions') { row.secret_ciphertext = null; row.enabled = 0; }
  if (name === 'webhook_deliveries') { row.state = 'failed'; row.last_error = 'restored_historical_command'; row.lease_id = null; row.lease_until = null; }
  if (name === 'analytics_connections') { row.credential_ciphertext=null; row.status='needs_reconnect'; row.reason='reauthorization_required'; }
  if (name === 'analytics_deliveries') { row.archive_historical=1; if (['pending','processing'].includes(row.state)) { row.state='failed'; row.reason='restored_historical_command'; } }
  if (name === 'meeting_polls') row.state = 'closed';
  if (name === 'bookings') {
    row.invitee_name_folded = foldBookingSearch(row.invitee_name);
    row.invitee_email_folded = foldBookingSearch(row.invitee_email);
  }
  if(name==='workspace_notice_destinations'){row.credential_ciphertext=null;row.status='needs_reconnect';row.reason='reauthorization_required';row.active_delivery_id=null;row.cooldown_until=null;}
  if(name==='workspace_notice_deliveries'&&['pending','invoking'].includes(row.state)){row.state='failed';row.reason='restored_historical_command';}
  if(name==='notice_erasure_requests')row.archive_historical=1;
  if (name === 'accounting_connections') { for (const key of ['access_token_ciphertext','refresh_token_ciphertext','expires_at']) row[key]=null; row.status='unhealthy'; row.reason='reauthorization_required'; }
  if (name === 'calendar_connections') {
    for (const key of ['access_token_ciphertext', 'refresh_token_ciphertext', 'access_token_expires_at', 'channel_id', 'channel_resource_id', 'channel_expires_at']) row[key] = null;
    if (row.status !== 'disconnected') { row.status = 'unhealthy'; row.unhealthy_code = 'reauthorization_required'; }
  }
  if (name === 'provider_connection_health') { row.status = 'unhealthy'; row.unhealthy_code = row.provider === 'google_calendar' ? 'reauthorization_required' : 'mail_check_required'; row.alert_state = 'unhealthy_announced'; }
  // Dev personas (<as>@dev.localhost) never travel active: Base suspends their auth rows in the archive, so the product's mirror row
  // is removed too, which is the pairing import checks.
  if (name === 'operators' && row.normalized_email.endsWith('@dev.localhost')) row.removed_at ??= row.updated_at;
  if (name === 'availability_requests') row.nonce_hash = `restored:${source.id}`;
  if(name==='booking_approval_requests') { row.claim_json=null; if(row.state==='pending'){row.state='expired';row.reason='Restored historical request; create a fresh request to reserve a time.';} }
  if (name === 'delivery_outbox') {
    const payload = parseJsonText(row.payload_json);
    row.payload_json = JSON.stringify({ ...payload, archiveHistorical: true });
    if (['pending', 'processing'].includes(row.state)) { row.state = 'failed'; row.last_error_code = 'restored_historical_command'; }
  }
  if (name === 'processor_erasure_requests' || name === 'calendar_deletion_probes' || name === 'erased_calendar_targets' || name === 'booking_reschedule_requests') row.archive_historical = 1;
  return row;
}
