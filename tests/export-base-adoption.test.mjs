import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { createArchive } from './archive/artifact.mjs';
import { captures, operators, request, runtime, token } from './archive/auth.mjs';
import { migrationFiles, schemaModel, tableQuery } from '../scripts/archive/schema.mjs';
import { restoreArchive } from './archive/artifact.mjs';
import { assertCoverage, exported, excluded } from '../scripts/archive/policy.mjs';
import { paymentErasureUpgrade, paidApprovalUpgrade, processorErasureUpgrade } from './archive/payment-erasure-upgrade.mjs';

contract('DATA-001', 'the actual Base cancellation ledger survives the full populated census and unknown future schema remains refused', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    await paymentErasureUpgrade(source.db);
    await paidApprovalUpgrade(source.db);
    await processorErasureUpgrade(source.db);
    source.db.exec("UPDATE payment_movements SET stripe_customer_id='synthetic-dial-customer-1',stripe_customer_observed=1; UPDATE person_erasure_receipts SET stripe_sessions_retained=1; UPDATE anonymized_audit SET reason='Person erasure before payment confirmation'");
    source.db.exec("UPDATE event_types SET booking_horizon_mode='fixed_range', booking_start_date='2026-10-07', booking_end_date='2026-10-31', slot_increment_minutes=45");
    const names = source.db.prepare(tableQuery).all().map(row => row.name);
    assertCoverage(names);
    assert.ok(exported.includes('oa_invitation_cancellations'));
    assert.ok(Object.hasOwn(excluded, 'rer_mail_development_outbox'));
    assert.ok(!names.includes('development_magic_link_sink'));
    assert.deepEqual(source.db.prepare('PRAGMA table_info(oa_invitation_cancellations)').all().map(row => row.name), ['operator_id', 'operator_version']);
    // EVENT-009: a populated prior-schema database receives only additive defaults and an empty guest table.
    const prior = new DatabaseSync(':memory:');
    try {
      const migrations=await migrationFiles(),guestMigration=migrations.find(row=>row.file==='core/0072_invitee_guests.sql');
      for(const migration of migrations.filter(row=>row!==guestMigration))prior.exec(migration.sql);
      prior.exec('PRAGMA foreign_keys=OFF');
      const priorTriggers=prior.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
      for(const trigger of priorTriggers)prior.exec(`DROP TRIGGER "${trigger.name}"`);
      const before={};
      for(const {name} of prior.prepare(tableQuery).all()) {
        if(name==='sqlite_sequence')continue;
        const columns=prior.prepare(`PRAGMA table_info("${name}")`).all().map(row=>row.name);
        const rows=source.db.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${name}"`).all();
        prior.exec(`DELETE FROM "${name}"`);
        for(const row of rows)prior.prepare(`INSERT INTO "${name}" (${columns.map(column=>`"${column}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
        before[name]={columns,rows};
      }
      for(const trigger of priorTriggers)prior.exec(trigger.sql);
      prior.exec(guestMigration.sql);
      for(const [name,{columns,rows}] of Object.entries(before))assert.deepEqual(prior.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${name}"`).all(),rows,`${name}: guest migration preserves prior rows`);
      for(const name of ['event_types','bookings'])assert.ok(prior.prepare(`SELECT guest_limit FROM ${name}`).all().every(row=>row.guest_limit===0),'existing rows keep guests disabled');
      assert.equal(prior.prepare('SELECT count(*) AS n FROM booking_guests').get().n,0);
    } finally { prior.close(); }
    // DATA-006: both current phone carriers remain personal booking custody.
    const phone = '+12025550101';
    source.db.prepare("UPDATE bookings SET location_type='invitee_phone',location_value=?").run(phone);
    source.db.prepare("UPDATE booking_answers SET question_kind='phone',value_json=?").run(JSON.stringify(phone));
    const archive = await createArchive(testPlatform(source.db));
    for (const table of archive.tables) {
      if (table.name === "operator_erasure_subjects") assert.equal(table.rows.length, 0, "unfinished operator erasure cannot be archived");
      else assert.ok(table.rows.length > 0, `${table.name} is populated`);
    }
    const ledger = source.db.prepare('SELECT * FROM oa_invitation_cancellations').all();
    const destination = testPlatform(target.db);
    const forged = await createArchive(testPlatform(source.db), undefined, { transformRow: (name, row) => name === 'bookings' ? { ...row, invitee_name_folded: 'attacker supplied unrelated match' } : row });
    await assert.rejects(restoreArchive(destination, forged), /archive-invalid-search-values/);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM bookings').get().n, 0, 'forged derived search data cannot cross the atomic restore boundary');
    for (const table of ['rer_erasure_operations', 'person_erasure_receipts']) {
      const pending = await createArchive(testPlatform(source.db), undefined, { transformRow: (name, row) => name === table ? { ...row, completed_at: null } : row });
      await assert.rejects(restoreArchive(destination, pending), /archive-erasure-incomplete/);
      assert.equal(target.db.prepare('SELECT count(*) AS n FROM bookings').get().n, 0, 'unfinished erasure cannot publish through restore');
    }
    source.db.exec("INSERT INTO operator_erasure_subjects VALUES('unfinished-subject')");
    await assert.rejects(createArchive(testPlatform(source.db)), /archive-erasure-incomplete/);
    source.db.exec('DELETE FROM operator_erasure_subjects');
    await restoreArchive(destination, archive);
    assert.deepEqual(target.db.prepare('SELECT * FROM oa_invitation_cancellations').all(), ledger);
    assert.deepEqual(target.db.prepare('SELECT * FROM oa_domain_rules').all(), source.db.prepare('SELECT * FROM oa_domain_rules').all());
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_step_up_challenges').get().n, 0);
    assert.deepEqual(await createArchive(destination), archive);
    assert.ok(target.db.prepare("SELECT location_value FROM bookings WHERE location_type='invitee_phone'").all().every(row => row.location_value === phone), 'DATA-006 invitee phone locations round-trip');
    assert.ok(target.db.prepare("SELECT value_json FROM booking_answers WHERE question_kind='phone'").all().every(row => JSON.parse(row.value_json) === phone), 'DATA-006 phone-question answers round-trip');
    assert.equal(target.db.prepare('SELECT browser_timezone FROM availability_requests').get().browser_timezone, 'America/Los_Angeles', 'AVAIL-012 request browser zone survives the public archive round trip');
    assert.equal(target.db.prepare('SELECT browser_timezone FROM booking_presentation').get().browser_timezone, 'America/New_York', 'AVAIL-012 booking preserves its independent invitee observation');
    for (const table of ['booking_guests', 'payment_connections', 'event_type_prices', 'booking_payments']) assert.deepEqual(target.db.prepare(`SELECT * FROM ${table}`).all(), source.db.prepare(`SELECT * FROM ${table}`).all(), `PAY-001 ${table} survives the archive round trip`);
    assert.ok(!archive.tables.some(table => ['payment_holds', 'payment_oauth_states'].includes(table.name)), 'PAY-001 live holds and OAuth state never travel');
    for (const table of ['event_type_payment_terms', 'booking_payment_terms', 'booking_card_consents', 'payment_movements', 'payment_settings']) assert.deepEqual(target.db.prepare(`SELECT * FROM ${table}`).all(), source.db.prepare(`SELECT * FROM ${table}`).all(), `PAY-003 ${table} survives the archive round trip`);
    assert.ok(!archive.tables.some(table => table.name === 'payment_link_tokens'), 'PAY-003 balance-link capabilities never travel');
    const approvals=archive.tables.find(table=>table.name==='booking_approval_requests');
    assert.ok(approvals.rows.every(row=>row.claim_json===null && row.state!=='pending'),'approval archives are historical and contain no executable claim');
    assert.ok(!archive.tables.some(table=>table.name==='booking_approval_tokens'),'approval request capabilities never travel');
    assert.deepEqual(target.db.prepare('SELECT state,claim_json FROM booking_approval_requests').all().map(row=>[row.state,row.claim_json]),[['expired',null]],'restored pending requests reserve no time and cannot be approved');
    assert.deepEqual(target.db.prepare('SELECT payment_json FROM booking_approval_requests').all(),source.db.prepare('SELECT payment_json FROM booking_approval_requests').all(),'PAY-007 processor history survives without its live claim, hold or capability');
    assert.throws(() => target.db.exec("UPDATE oa_operators SET status='active' WHERE id='zz-cancelled'"), /invitation_required/);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM rer_mail_development_outbox').get().n, 0);
    // Future clipboard storage must be classified from its eventual migration,
    // never pre-authorized through a wildcard or guessed table name.
    target.db.exec('CREATE TABLE unclassified_future_data(id TEXT)');
    await assert.rejects(createArchive(destination), /unclassified-schema/);
  } finally { source.db.close(); target.db.close(); }
});

contract('OPER-002', 'restored Dial identities retain setup and cancellation guards through fresh local mail, reissue, cancellation and acceptance', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const destination = testPlatform(target.db);
    await restoreArchive(destination, await createArchive(testPlatform(source.db)));
    const service = await operators(destination.binding);
    const bootstrap = target.db.prepare('SELECT * FROM oa_bootstrap').all();
    const setup = target.db.prepare('SELECT * FROM operator_setup_identity').all();
    assert.ok(setup[0].onboarding_completed_at, 'restored first-run completion survives provider health redaction');
    const identity = target.db.prepare("SELECT id,email,created_at FROM oa_operators WHERE id='zz-cancelled'").get();
    const ledger = target.db.prepare('SELECT * FROM oa_invitation_cancellations').all();
    assert.equal((await service.handle(request('/auth/bootstrap', { token: runtime.SETUP_TOKEN, displayName: 'Second owner' }))).status, 409);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_sessions').get().n, 0);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_tokens').get().n, 0);
    await service.requestMagicLink(request('/api/auth/magic-links', {}), 'cancelled@example.test');
    assert.equal((await captures(destination.binding)).length, 0);
    await service.requestMagicLink(request('/api/auth/magic-links', {}), 'owner@example.test');
    const firstMail = (await captures(destination.binding))[0].message;
    assert.equal(firstMail.subject, 'Your sign-in link for Dial');
    assert.match(firstMail.html, /background:#1d1c1a;color:#ffffff/);
    const signedIn = await service.handle(request('/auth/confirm', { token: token(firstMail) }));
    assert.equal(signedIn.status, 303);
    const cookie = signedIn.headers.get('set-cookie').split(';')[0];
    const actor = request('/api/app/operators', {}, cookie);
    assert.equal((await service.authenticate(actor)).id, 'owner');
    assert.deepEqual(target.db.prepare('SELECT * FROM oa_invitation_cancellations').all(), ledger);
    await assert.rejects(service.auth.setOperatorStatus(actor, identity.id, 'active'), error => error.code === 'invitation_required');
    await assert.rejects(service.auth.setOperatorStatus(actor, 'owner', 'inactive'), error => error.code === 'last_owner');
    const input = { email: identity.email, displayName: 'Reinvited', role: 'owner', returnTo: '/app' };
    const retired = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      await service.auth.invite(actor, input);
      const message = (await captures(destination.binding)).find(row => row.message.to.includes(identity.email)).message;
      retired.push(token(message));
      assert.equal(message.subject, "You're invited to Dial");
      assert.match(message.html, /background:#1d1c1a;color:#ffffff/);
      assert.deepEqual(target.db.prepare('SELECT id,email,created_at FROM oa_operators WHERE id=?').get(identity.id), identity);
      assert.equal(target.db.prepare('SELECT status FROM oa_operators WHERE id=?').get(identity.id).status, 'invited');
      assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_invitation_cancellations').get().n, 1);
      await assert.rejects(service.auth.setOperatorStatus(actor, identity.id, 'active'), error => error.code === 'invitation_required');
      if (cycle === 0) {
        await service.auth.cancelInvitation(actor, identity.id);
        assert.equal((await service.handle(request('/auth/confirm', { token: retired[0] }))).status, 400);
      }
    }
    const preview = await service.handle(request(`/auth/confirm?token=${retired[1]}`));
    assert.equal(preview.status, 200); assert.equal(preview.headers.get('set-cookie'), null);
    const accepted = await service.handle(request('/auth/confirm', { token: retired[1] }));
    assert.equal(accepted.status, 303);
    assert.equal(target.db.prepare('SELECT status FROM oa_operators WHERE id=?').get(identity.id).status, 'active');
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM oa_invitation_cancellations').get().n, 0);
    for (const old of retired) assert.equal((await service.handle(request('/auth/confirm', { token: old }))).status, 400);
    const newActor = request('/api/app/operators', {}, accepted.headers.get('set-cookie').split(';')[0]);
    await assert.rejects(service.auth.setOperatorStatus(newActor, 'owner', 'inactive'), error => error.status === 403);
    assert.deepEqual(target.db.prepare('SELECT * FROM oa_bootstrap').all(), bootstrap);
    assert.deepEqual(target.db.prepare('SELECT * FROM operator_setup_identity').all(), setup);
    assert.equal(target.db.prepare("SELECT count(*) AS n FROM oa_operators WHERE email='second@example.test'").get().n, 0);
    const messages = await captures(destination.binding);
    assert.equal(messages.length, 3);
    const credentials = messages.map(row => token(row.message));
    target.db.prepare('UPDATE host_profiles SET biography=?').run(`Preserved biography ${credentials.join(' ')}`);
    const archive = await createArchive(destination);
    assert.ok(!archive.tables.some(table => table.name === 'rer_mail_development_outbox'));
    for (const credential of credentials) assert.ok(!JSON.stringify(archive).includes(credential), 'captured credentials cannot escape through authored fields');
    assert.match(archive.tables.find(table => table.name === 'host_profiles').rows[0].biography, /Preserved biography/);
  } finally { source.db.close(); target.db.close(); }
});

contract('OPER-005', 'whole-install transfer preserves unfinished first-run state as unfinished', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    source.db.exec("UPDATE operator_setup_identity SET onboarding_completed_at=NULL");
    const archive = await createArchive(testPlatform(source.db));
    const destination = testPlatform(target.db);
    await restoreArchive(destination, archive);
    assert.equal(target.db.prepare("SELECT onboarding_completed_at FROM operator_setup_identity").get().onboarding_completed_at, null);
    assert.deepEqual(await createArchive(destination), archive);
    assert.equal(target.db.prepare('SELECT browser_timezone FROM availability_requests').get().browser_timezone, 'America/Los_Angeles', 'AVAIL-012 request browser zone survives the public archive round trip');
    assert.equal(target.db.prepare('SELECT browser_timezone FROM booking_presentation').get().browser_timezone, 'America/New_York', 'AVAIL-012 booking preserves its independent invitee observation');
  } finally { source.db.close(); target.db.close(); }
});
