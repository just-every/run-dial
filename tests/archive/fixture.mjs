import { routingOverrides } from "./routing-fixture.mjs";
import { foldBookingSearch } from '../../src/core/features/bookings/search/case-fold.mjs';
import { schemaModel, quote } from '../../scripts/archive/schema.mjs';
import { chunks } from '../../scripts/archive/streams.mjs';
import { exported } from '../../scripts/archive/policy.mjs';
export const instant = '2026-10-07T00:00:00.000Z';
export const healthChanges = [
  { id: 'calendar-health-lost', event_type: 'calendar.connection-health-changed.v1', from_state: 'healthy', to_state: 'unhealthy', reason: 'reauthorization_required', occurred_at: '2026-10-06T23:00:00.000Z', created_at: '2026-10-06T23:00:00.000Z', updated_at: '2026-10-06T23:00:00.000Z' },
  { id: 'calendar-health-restored', event_type: 'calendar.connection-health-changed.v1', from_state: 'unhealthy', to_state: 'healthy', reason: 'connection_restored', occurred_at: instant, created_at: instant, updated_at: instant },
];
export const secret = 'synthetic-PLANTED_PRIVATE_CREDENTIAL_0123456789';
export const copyReport = {
  id: '01K6Z21FDK9C9E2RVFQDBCGD53', event_type_id: 'event_types-1',
  canonical_url: 'https://dial.example.test/book/host/event_types.slug',
  accepted_at: '2026-10-07T00:01:02.003Z', created_at: '2026-10-06T23:58:59.001Z', updated_at: '2026-10-07T00:01:02.003Z',
};
const end = '2026-10-07T01:00:00.000Z';
const correspondence = JSON.stringify({ inviteeConfirmationEnabled: false, invitationManageLinkEnabled: false, templates: {
  calendarTitle: '{event name} with {invitee full name}',
  calendarDescription: '{date and time}\n{duration}\n{location}',
  confirmationSubject: 'Confirmed: {event name}',
  confirmationBody: 'Hello {invitee first name},\nMeet {host name}: {manage link}',
  rescheduleSubject: 'Rescheduled: {event name}',
  rescheduleBody: '{date and time}\n{message}\n{manage link}',
  cancellationSubject: 'Cancelled: {event name}',
  cancellationBody: '{message}',
  reminderSubject: 'Reminder: {event name}',
  reminderBody: null,
} });
const overrides = {
  ...routingOverrides,
  meeting_polls:{state:'open',title:'Project planning',closes_at:end,show_tally:0},
  poll_participants:{name:'Alex Rivera',email:'invitee@example.test'},
  poll_votes:{choice:'yes'},
  client_profiles: { email:'invitee@example.test' },
  client_aliases: { email:'invitee@example.test' },
  client_notes: { body:'Private client preparation notes',operator_id:'owner' },
  client_fields: { label:'Client reference',value:'synthetic-dial-1002' },
  processor_erasure_requests: {receipt_id:'person_erasure_receipts-1',kind:'stripe_customer_anonymize',actor_id:'owner',amount_cents:0,purpose:'Person erasure',account_id:'synthetic-dial-account-1',processor_ref:'synthetic-dial-customer-1',lookup_key:null,state:'completed',reason:null,requested:1,attempt_started_at:null,archive_historical:1},
  booking_approval_requests: {nonce_id:'synthetic-dial-approval-nonce',booking_id:'bookings-1',event_type_id:'event_types-1',state:'pending',invitee_email:'synthetic-dial-approval@example.test',invitee_name:'Synthetic Dial Approval',event_title:'Synthetic approval',start_at:instant,end_at:end,occupied_start_at:instant,occupied_end_at:end,host_date:'2026-10-07',claim_json:JSON.stringify({emails:[],invitee:{guests:[]}}),payment_json:JSON.stringify({holdId:'synthetic-dial-hold-1',mode:'payment',amountCents:21775,accountId:'synthetic-dial-account-1',paymentIntentId:'synthetic-dial-intent-1',setupIntentId:'synthetic-dial-setup-1',customerId:'synthetic-dial-customer-1',paymentMethodId:'synthetic-dial-card-1',saveCard:true,consentVersion:'synthetic-dial-consent-1',setupExpiresAt:instant,state:'capture_pending',authorizedAt:instant,audit:{authorize:'synthetic-dial-auth-1',capture:'synthetic-dial-capture-1',void:'synthetic-dial-void-1',detach:'synthetic-dial-detach-1',refund:'synthetic-dial-refund-1'}})},
  booking_guests: { booking_id:'bookings-1',email:'synthetic-dial-guest@example.test' },
  booking_links: { kind:'single_use',overrides_json:null,expires_at:end,consumed_at:instant,consumed_booking_id:'bookings-1',revoked_at:null },
  booking_reschedule_requests: { state:'open',message:'Please choose a new time.',release_time:1,actor_id:'owner',expires_at:end,reminder_at:null,reminded_at:null },
  booking_request_history: {action:'reschedule_requested',actor_type:'operator',actor_id:'owner',reason:'Please choose a new time.'},
  availability_schedules: { name: 'Working hours', windows_json: '[{"weekday":1,"startMinute":540,"endMinute":600}]', block_us_holidays: 1, reopened_holidays_json: '["2026-11-11"]', time_off_json: '[{"startDate":"2026-12-23","endDate":"2026-12-27"}]' },
  booking_limit_policies: { scope: 'host', limits_json: '{"dayCount":null,"weekCount":null,"monthCount":10,"dayMinutes":null,"weekMinutes":240,"monthMinutes":null,"inviteeGapMinutes":120}' },
  event_booking_policies: { locked_timezone: 'Australia/Brisbane', reschedule_cutoff_minutes: 120, cancellation_cutoff_minutes: 60, reschedule_cap: 3 },
  booking_presentation: { locked_timezone: 'Australia/Brisbane', browser_timezone: 'America/New_York' },
  event_correspondence: { templates_json: correspondence },
  booking_correspondence: { templates_json: correspondence },
  // A historical header-only job was retired; its anonymous receipt outlives the job.
  ik_d1_erasure_journal: { id: 'ik_d1_erasure_journal-1', destination: 'archive-history', recorded_at: instant, records_erased: 0, jobs_retired: 1, streams_retired: 0, stores_json: JSON.stringify([{ store: 'ik_jobs', rows: 1 }]) },
  ik_d1_retirements: { id: 'ik_jobs-retired-1', kind: 'job', destination: 'archive-history', receipt_id: 'ik_d1_erasure_journal-1', retired_at: instant },
  rer_erasure_operations: { entity: "booking", subject: null, label: "Erased booking", phase: "complete", planned: "{}", deleted: "{}", retained: "[]", committed_at: instant, completed_at: instant },
  person_erasure_receipts: { bookings: 1, requests: 0, completed_at: instant },
  move_in_captures: { mode: 'catch_up', captured_at: instant },
  move_in_source_links: { event_type_id: 'event_types-1', source_url: 'https://schedule.example.test/host/event' },
  move_in_differences: { booking_id: 'bookings-1', kind: 'cancelled', decision: 'released', decided_at: instant },
  ext_custom_field_definitions: { entity: 'booking', label: 'Internal preparation', kind: 'text', options_json: '[]' },
  ext_custom_field_values: { definition_id: 'ext_custom_field_definitions-1', entity: 'booking', kind: 'text', event_type_id: null, booking_id: 'bookings-1', request_id: null, value_json: '"Private archive annotation"' },
  operators: { id: 'owner', email: 'owner@example.test', normalized_email: 'owner@example.test' },
  oa_operators: { id: 'owner', email: 'owner@example.test', display_name: 'Owner', role: 'owner', status: 'active', created_at: 1791331200000 },
  oa_invitation_cancellations: { operator_id: 'zz-cancelled', operator_version: 2 },
  oa_domain_rules: { domain: 'restricted.example.test', provider_id: 'retained-provider', created_by: 'owner', created_at: 1791331200000 },
  oa_bootstrap: { singleton: 1, claim_id: 'owner', claimed_at: 1791331200000 },
  oc_owner_claims: { email: 'owner@example.test', operator_id: 'owner', issued_at: 1791331200000, consumed_at: 1791331201000, expires_at: 1791331500000, completed: 1 },
  operator_setup_identity: { operator_id: 'owner', onboarding_completed_at: instant },
  host_profiles: { singleton_key: 'default', handle: 'host', timezone: 'UTC' },
  host_link_copy_reports: copyReport,
  event_types: { status: 'published', duration_minutes: 30, location_type: 'google_meet', slot_increment_minutes: 15, minimum_notice_minutes: 0, booking_horizon_days: 60, duration_options_json: '[30,60]', post_booking_redirect_json: JSON.stringify({ url: 'https://studio.example.test/thank-you', fields: ['event', 'utm_source'] }) },
  event_questions: { kind: 'text', options_json: '[]' },
  recurring_availability_windows: { weekday: 1, start_minute: 540, end_minute: 600 },
  availability_date_overrides: { host_date: '2026-10-07', mode: 'open' },
  availability_date_override_windows: { start_minute: 540, end_minute: 600 },
  calendar_connections: { singleton_key: 'default', provider: 'google', status: 'healthy', access_token_ciphertext: secret + '_ACCESS', refresh_token_ciphertext: secret + '_REFRESH', access_token_expires_at: end, authorised_by_operator_id: 'owner', sync_cursor: 'retained-sync-cursor', channel_id: secret + '_CHANNEL', account_email: 'calendar@example.test' },
  calendar_connection_calendars: { purpose: 'destination', calendar_id: 'calendar@example.test' },
  calendar_connection_health_changes: healthChanges[0],
  provider_connection_health: { provider: 'google_calendar', status: 'healthy', alert_state: 'healthy_announced' },
  calendar_busy_intervals: { starts_at: instant, ends_at: end, transparency: 'opaque' },
  calendar_busy_read_windows: { starts_at: instant, ends_at: end },
  delivery_outbox: { kind: 'mail_send', state: 'pending', booking_id: 'bookings-1', occurrence_id: 'booking_occurrences-1', payload_json: JSON.stringify({ recipientRole: 'invitee', to: 'invitee@example.test', subject: 'Historical confirmation', wireMail: { text: `https://dial.example.test/manage/${secret}_MANAGE`, html: secret + '_HTML' }, settings: { nested: { webhookSecret: secret + '_WEBHOOK', accessToken: secret + '_NESTED', keep: 'delivery fact' } }, manageUrl: `https://dial.example.test/manage/${secret}_MANAGE`, rawBody: `visit https://dial.example.test/manage/${secret}_URL`, serialized: JSON.stringify({ setupToken: secret + '_SETUP', value: 'fact' }) }) },
  delivery_attempts: { attempt_number: 1, outcome: 'retrying' },
  provider_webhook_events: { provider: 'google_calendar', state: 'processed' },
  bookings: { attribution_json: JSON.stringify({ utm_source: 'archive-campaign', source: 'studio-site' }), post_booking_redirect_url: 'https://studio.example.test/thank-you?event=Planning&utm_source=archive-campaign', duration_minutes: 30, state: 'confirmed', calendar_state: 'pending', meeting_state: 'pending', current_occurrence_id: 'booking_occurrences-1', event_type_id: 'event_types-1', host_timezone: 'UTC', invitee_timezone: 'UTC', invitee_email: 'invitee@example.test' },
  booking_occurrences: { sequence: 0, start_at: instant, end_at: end, occupied_start_at: instant, occupied_end_at: end, host_date: '2026-10-07', state: 'current', is_current: 1 },
  booking_answers: { value_json: JSON.stringify(JSON.stringify({ answer: 'Preserve this answer', text: 'Preserve structured answer text', nested: { refresh_token: secret + '_ANSWER' } })) },
  booking_history: { action: 'created', actor_type: 'operator', actor_id: 'owner' },
  booking_attendance: { status: 'attended' },
  blocked_address_rules: { kind: 'email', value: 'blocked@example.test' },
  availability_requests: { state: 'submitted', nonce_hash: secret + '_NONCE', invitee_timezone: 'America/New_York', browser_timezone: 'America/Los_Angeles' },
  availability_request_windows: { requested_date: '2026-10-08', start_minute: 600, end_minute: 660 },
  embed_allowed_origins: { origin: 'https://example.test' },
  booking_calendar_conflicts: { state: 'open' },
  anonymized_audit: { actor_type: 'operator', actor_id: 'owner' },
  calendar_deletion_probes: { state: 'pending', occurrence_id: 'booking_occurrences-1' },
  operator_mail_invocations: { state: 'invoking', attempt_number: 2 },
  base_mail_dispatch: { state: 'uncertain' },
  payment_connections: { status: 'connected', account_id: 'acct_fixture', ach_enabled: 1 },
  event_type_prices: { duration_minutes: 0, amount_cents: 5000 },
  booking_payments: { amount_cents: 5000, account_id: 'acct_fixture', checkout_session_id: 'cs_test_fixture', payment_intent_id: 'pi_test_fixture', kind: 'deposit' },
  event_type_payment_terms: { deposit_kind: 'fixed', deposit_value: 1000, balance_due_hours: 24, free_window_hours: 48, late_cancel_fee_cents: 1500, no_show_fee_cents: 2500 },
  booking_payment_terms: { price_cents: 6000, deposit_cents: 5000, due_now_cents: 5000, balance_cents: 1000, balance_due_hours: 24, free_window_hours: 48, late_cancel_fee_cents: 1500, no_show_fee_cents: 2500, terms_version: 2 },
  booking_card_consents: { consent_text_version: 'card-consent.v1', free_window_hours: 48, late_cancel_fee_cents: 1500, no_show_fee_cents: 2500, account_id: 'acct_fixture', stripe_customer_id: 'cus_test_fixture', stripe_payment_method_id: 'pm_test_fixture' },
  payment_processor_facts: {kind:'dispute',account_id:'synthetic-dial-1',processor_ref:'synthetic-dial-2',source_ref:'synthetic-dial-3',amount_cents:5000,status:'needs_response',disagreement:1,event_created:1},
  accounting_connections: {id:'quickbooks',realm_id:'synthetic-dial-4',status:'connected',access_token_ciphertext:secret+'_ACCOUNTING_ACCESS',refresh_token_ciphertext:secret+'_ACCOUNTING_REFRESH'},
  accounting_exports: {connection_id:'quickbooks',payment_ref:'synthetic-dial-3',amount_cents:5000,request_id:'synthetic-dial-5',document_ref:'synthetic-dial-5',payload_json:'{}',receipt_id:'synthetic-dial-6',state:'exported'},
  analytics_settings: {id:'default',tags_json:JSON.stringify({ga4MeasurementId:'G-SYNTHETIC930'})},
  analytics_connections: {provider:'google_ads',generation:1,status:'connected',credential_ciphertext:secret+'_ANALYTICS',destination_json:JSON.stringify({customerId:'1234567890',conversionAction:['customers','1234567890','conversionActions','930'].join('/')})},
  analytics_deliveries: {provider:'google_ads',generation:1,event_id:'synthetic-dial-930',click_id:'synthetic-dial-931',destination_json:JSON.stringify({customerId:'1234567890',conversionAction:['customers','1234567890','conversionActions','930'].join('/')}),confirmed_at:instant,state:'pending'},
  workspace_notice_destinations:{id:'slack',status:'connected',target:'synthetic-dial-700',external_key:'synthetic-dial-701',masked_tail:'••••-700',credential_ciphertext:secret+'_NOTICE'},
  workspace_notice_deliveries:{destination_id:'slack',account_id:'synthetic-dial-701',channel_id:'synthetic-dial-700',event_kind:'created',state:'pending'},
  notice_erasure_requests:{provider:'slack',source_delivery_id:'synthetic-dial-702',account_id:'synthetic-dial-701',channel_id:'synthetic-dial-700',state:'pending'},
  payment_settings: { singleton_key: 'default', tax_enabled: 1, business_name: 'Morgan Bell Coaching' },
  payment_movements: { kind: 'refund', tax_cents: 99, tax_summary: 'NY Sales Tax 8.875%', amount_cents: 1200, status: 'succeeded', actor_type: 'operator', actor_id: 'owner', reason: 'Partial refund for a late start', account_id: 'acct_fixture', source_ref: 'pi_test_fixture', processor_ref: 're_test_fixture', checkout_session_id: null, idempotency_key: 'fixture-refund:0' },
};
export async function fixture() {
  const model = await schemaModel();
  const db = model.db;
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${quote(trigger.name)}`);
  for (const name of exported) {
    // This semantic root exists only while erasure is incomplete; native archive policy requires it empty.
    if (name === "operator_erasure_subjects") continue;
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const row = Object.fromEntries(columns.map(column => {
      let value = null;
      if (column.dflt_value !== null) value = db.prepare(`SELECT ${column.dflt_value} AS v`).get().v;
      else if (column.notnull || column.pk) value = column.type === 'INTEGER' ? 1 : column.name === 'id' ? `${name}-1` : /_at$/.test(column.name) ? instant : column.name === 'singleton_key' ? 'default' : `${name}.${column.name}`;
      return [column.name, value];
    }));
    for (const foreign of db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all()) row[foreign.from] = foreign.table === 'operators' || foreign.table === 'oa_operators' ? 'owner' : `${foreign.table}-1`;
    Object.assign(row, overrides[name]);
    if (name === 'bookings') { row.invitee_name_folded = foldBookingSearch(row.invitee_name); row.invitee_email_folded = foldBookingSearch(row.invitee_email); }
    db.prepare(`INSERT INTO ${quote(name)} (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
  }
  for (const row of healthChanges.slice(1)) db.prepare(`INSERT INTO calendar_connection_health_changes (${Object.keys(row).map(quote)}) VALUES (${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
  for (const trigger of triggers) db.exec(trigger.sql);
  db.exec("INSERT INTO oa_operators VALUES ('zz-cancelled','cancelled@example.test','Cancelled invite','owner','inactive',2,1791331200000)");
  db.exec(`INSERT INTO booking_manage_tokens VALUES('manage','bookings-1','${secret}_MANAGE_HASH','2099',NULL,NULL,'${instant}','${instant}');
    INSERT INTO oa_tokens VALUES('old-token','${secret}_AUTH','magic','owner',1,NULL,NULL,'/app',1,9999999999999,NULL,NULL);
    INSERT INTO rer_mail_development_outbox(id,created_at,message) VALUES('captured-signin',1791331200000,'{"deliveryId":"old-token","from":"mail@example.test","to":["owner@example.test"],"subject":"Your sign-in link for Dial","text":"https://dial.example.test/auth/confirm?token=${secret}_MAGIC"}');
    INSERT INTO oa_sessions VALUES('old-session','${secret}_SESSION','owner',1,'native','old-token',1,9999999999999,NULL);
    INSERT INTO oa_step_up_challenges VALUES('old-proof','${secret}_STEP_UP','old-session','owner',1,'domain-rule:set','/app',1,9999999999999,NULL);`);
  db.exec('COMMIT');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('fixture foreign keys');
  return model;
}
export function sqliteBinding(sqlite) {
  const prepare = (sql, args = []) => ({ bind: (...values) => prepare(sql, values),
    async raw() { const statement = sqlite.prepare(sql); statement.setReturnArrays(true); return statement.all(...args); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { const results = sqlite.prepare(sql).all(...args); return { success: true, results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
  });
  return { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
}
export function testPlatform(db) {
  const objects = new Map(); const writes = { database: 0, objects: 0 }; const binding = sqliteBinding(db);
  return {
    objects, writes, binding,
    knownSecrets: () => [],
    query: async (sql, params = []) => db.prepare(sql).all(...params),
    async batch(statements) { if (statements.some(statement => !/^SELECT/.test(statement.sql))) writes.database++;
      return (await binding.batch(statements.map(({ sql, params }) => binding.prepare(sql).bind(...params)))).map(result => result.results); },
    listObjects: async () => [...objects.keys()].map(key => ({ key })),
    getObject: async key => { const object = objects.get(key); return object && { body: object.bytes, size: object.bytes.length, contentType: object.contentType }; },
    async putObject(key, body, contentType) { const buffers = []; for await (const bytes of chunks(body)) buffers.push(bytes); writes.objects++; objects.set(key, { bytes: Buffer.concat(buffers), contentType }); },
  };
}
