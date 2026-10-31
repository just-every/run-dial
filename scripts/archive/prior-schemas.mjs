import { DatabaseSync } from 'node:sqlite';
import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history';
import { applicationCatalog, catalogQuery } from './catalog.mjs';
import { migrationFiles } from './schema.mjs';
import { exported } from './policy.mjs';

// A backup made before Dial's latest migrations restores through Base's
// acceptedSchemas. Each later migration states here exactly what it does to a
// row that already existed, so a restored row ends as that migration leaves it.
// A later migration without an entry ends acceptance: older backups refuse.
const json = new DatabaseSync(':memory:');
const confirmation = json.prepare("SELECT CASE WHEN json_type(?1, '$.inviteeConfirmationEnabled') IS NULL THEN json_set(?1, '$.inviteeConfirmationEnabled', json('true')) ELSE ?1 END AS templates_json");
const invitation = json.prepare("SELECT CASE WHEN json_type(?1, '$.invitationManageLinkEnabled') IS NULL THEN json_set(?1, '$.invitationManageLinkEnabled', json('true')) ELSE ?1 END AS templates_json");
export const rowUpgrades = {
  'core/0094_coupon_issuance_receipts.sql': (table,row) => table==='payment_products'?{...row,issuance_key_hash:null}:row,
  // Existing credits keep their previous meaning; no historical coupon or discount is invented.
  'core/0093_payment_coupons.sql': (table,row) => ['payment_products','payment_entitlements'].includes(table)?{...row,is_coupon:0}:table==='payment_redemptions'?{...row,discount_cents:0}:row,
  'core/0095_api_consent.sql': (table,row) => table==='api_oauth_applications'?{...row,grant_type:'client_credentials',redirect_uri:null}:table==='api_credentials'?{...row,oauth_grant_id:null}:row,
  // Authored workflow configuration starts empty in earlier archives.
  'core/0092_workflows.sql': (_table, row) => row,
  // Credential metadata and replay tables are additive and start empty in earlier archives.
  'core/0090_api_credentials.sql': (_table, row) => row,
  'core/0091_public_api.sql': (_table, row) => row,
  // Relationship cleanup triggers do not change any existing archived row.
  'core/0089_event_type_webhook_cleanup.sql': (_table, row) => row,
  'core/0087_webhook_sources.sql': (_table,row) => row,
  'core/0088_webhooks.sql': (_table,row) => row,
  // The role boundary changes triggers only; existing archived rows are unchanged.
  'core/0086_import_role_boundary.sql': (_table, row) => row,
  // Analytics tables are additive and start empty in earlier archives.
  'core/0085_analytics.sql': (_table, row) => row,
  // CAL-010 widens the supported provider constraint while preserving existing connection values.
  'core/0084_microsoft_calendar.sql': (_table,row) => row,
  // PAY-004 adds new empty catalog, purchaser balance, redemption and replay tables.
  'core/0083_payment_entitlements.sql': (_table,row) => row,
  // A schedule existed before any was yours; transfer.mjs replays the update's choice after the restore (your-hours.mjs).
  'core/0081_your_hours.sql': (table,row) => table==='availability_schedules'?{...row,is_default:0}:row,
  'core/0078_meeting_polls.sql': (_table,row) => row,
  'core/0077_client_records.sql': (_table,row) => row,
  'core/0080_workspace_notices.sql': (_table,row) => row,
  // BRAND-001: the site look's table starts empty; an older backup has no website read.
  'core/0082_site_look.sql': (_table,row) => row,
  'core/0079_payment_reconciliation.sql': (_table,row) => row,
  'core/0076_processor_erasure_requests.sql': (_table,row) => row,
  'core/0075_paid_approval.sql': (table,row) => table==='booking_approval_requests'?{...row,payment_json:null}:row,
  'core/0074_payment_erasure.sql': (table,row) => table==='payment_movements'?{...row,stripe_customer_id:null,stripe_customer_observed:0}:table==='person_erasure_receipts'?{...row,stripe_sessions_retained:null}:table==='anonymized_audit'?{...row,reason:null}:row,
  'core/0073_booking_approval_requests.sql': (table,row) => table==='event_types'?{...row,approval_required:0,approval_window_hours:24}:row,
  'core/0072_invitee_guests.sql': (table,row) => ['event_types','bookings'].includes(table) ? {...row,guest_limit:0} : row,
  // D7: an older erasure receipt never counted the payer's Stripe customers; NULL says so.
  'core/0071_erasure_stripe_customers.sql': (table, row) => table === 'person_erasure_receipts' ? { ...row, stripe_customers_retained: null } : row,
  // PAY-005: tax starts off; existing payments, terms and movements carry no tax and no invoice.
  'core/0070_sales_tax_receipts_invoices.sql': (table, row) => ['booking_payments', 'booking_payment_terms'].includes(table) ? { ...row, tax_cents: 0, tax_summary: null }
    : table === 'payment_movements' ? { ...row, tax_cents: 0, tax_summary: null, invoice_id: null, invoice_number: null, invoice_url: null } : row,
  // Additive PAY-003 tables start empty. An existing payment was the full price; older audit and erasure-receipt
  // rows carry no amount, Stripe reference or saved-card counts.
  'core/0069_deposits_refunds_fees.sql': (table, row) => table === 'booking_payments' ? { ...row, kind: 'payment' }
    : table === 'anonymized_audit' ? { ...row, amount_cents: null, processor_ref: null }
    : table === 'person_erasure_receipts' ? { ...row, saved_cards_detached: null, saved_card_failures: null } : row,
  // Additive payment tables start empty; an older backup has no prices, connection or payments.
  'core/0068_stripe_payments.sql': (_table, row) => row,
  // Historical requests have no invitee browser observation; do not infer one.
  'core/0067_request_browser_timezone.sql': (table, row) => table === 'availability_requests' ? { ...row, browser_timezone: null } : row,
  // Additive history starts empty; an older backup cannot supply past transitions.
  'core/0066_calendar_connection_health_changes.sql': (_table, row) => row,
  'core/0065_invitation_rotation_audit.sql': (_table, row) => row,
  'core/0064_invitation_manage_link.sql': (table, row) => ['event_correspondence', 'booking_correspondence'].includes(table)
    ? { ...row, templates_json: invitation.get(row.templates_json).templates_json } : row,
  // ALTER TABLE ADD COLUMN without a default: existing links hold NULL.
  'core/0062_offered_times.sql': (table, row) => table === 'booking_links' ? { ...row, offered_slots_json: null, hold_until: null } : row,
  // The same json_set the migration runs on correspondence saved before the switch.
  'core/0063_invitee_confirmation.sql': (table, row) => ['event_correspondence', 'booking_correspondence'].includes(table)
    ? { ...row, templates_json: confirmation.get(row.templates_json).templates_json } : row,
};

/** Each earlier schema whose later migrations all declare their row upgrade: its
 * Base schema identity under `policy`, the schema proofs that Dial's export of
 * each migration set with that schema carries (the same files and hashes, and the
 * catalog they create), and the composed row upgrade. Sets that differ only by
 * data-only migrations share one identity, and Base picks the upgrade by identity
 * before it reads the proof, so the group upgrades from its earliest set: a
 * data-only migration's entry leaves a row it already migrated unchanged (as the
 * guarded json_set of 0063 and 0064 does). A set whose schema matches the current
 * one (later migrations changed only data) is left to Base's own migration placement. */
export async function priorSchemas(policy) {
  const files = await migrationFiles(), result = new Map();
  const identity = names => migrationReplay(files.map(m => ({ name: m.file, statements: [m.sql], sha256: m.sha256 })), policy).schemaAfter(names);
  const current = await identity(files.map(m => m.file));
  for (let k = files.length - 1; k > 0 && Object.hasOwn(rowUpgrades, files[k].file); k--) {
    const earlier = files.slice(0, k), later = files.slice(k).map(m => rowUpgrades[m.file]);
    const db = new DatabaseSync(':memory:');
    let catalog;
    try { for (const { sql } of earlier) db.exec(sql); catalog = applicationCatalog(db.prepare(catalogQuery).all()); }
    finally { db.close(); }
    const schema = await identity(earlier.map(m => m.file));
    if (schema === current) continue;
    const proof = JSON.stringify({ migrations: earlier.map(({ file, sha256 }) => ({ file, sha256 })), catalog });
    const emptyTables = exported.filter(name => !catalog.some(entry => entry.type === 'table' && entry.name === name));
    const upgradeRow = (table, row) => later.reduce((value, upgrade) => upgrade(table, value), row);
    const group = result.get(schema);
    if (group) Object.assign(group, { proofs: [...group.proofs, proof], upgradeRow });
    else result.set(schema, { identity: schema, proofs: [proof], upgradeRow, emptyTables });
  }
  return [...result.values()];
}
