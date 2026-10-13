import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { importPeople, people, erase, finish, refuseReplay, assertErased, custodyEvidence } from './erasure/import-custody.mjs';
import { snapshot } from './erasure/scan.mjs';

contract('DATA-002', 'person HTTP erasure preserves safe undo and refuses unsupported shared-source erasure before mutation', async context => {
  const rt = await bookingRuntime();
  try {
    const cancelled = { email: 'cancelled-shared-94127@example.test', name: 'CANCELLED_SHARED_94127', answer: 'CANCELLED_ANSWER_94127' };
    const historical = await importPeople(rt, people, cancelled);
    await finish(rt, await rt.data(`/api/app/move-in/jobs/${historical.job.id}/undo`, {}), 'undone');
    const imported = await importPeople(rt, people, cancelled);
    assert.notEqual(imported.job.id, historical.job.id);
    const rows = await rt.data('/api/app/bookings'), peer = rows.find(row => row.inviteeEmail === people[1].email);
    const peerBefore = await rt.data(`/api/app/bookings/${peer.id}`);
    const refuseShared = async () => {
      const preview = await rt.data('/api/app/privacy/preview', { email: cancelled.email });
      const before = await snapshot(rt.db), counts = await custodyEvidence(rt, cancelled);
      assert.ok(Object.values(counts.custody).some(row => row.personalRows > 0));
      const response = await rt.api('/api/app/privacy/erase', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email:cancelled.email,confirmation:preview.confirmation,expiresAt:preview.expiresAt}) });
      assert.equal(response.status, 503);
      const refusal = await response.json();
      assert.equal(refusal.error.code, 'erasure_import_shared_source');
      context.diagnostic(JSON.stringify({ sharedSourceRefusal: refusal.error }));
      const after = await snapshot(rt.db);
      for (const table of Object.keys(before).filter(name => /^(ik_|rer_portability_|move_in_|bookings$|booking_|person_erasure_)/u.test(name))) assert.deepEqual(after[table], before[table], `${table}: unsupported erasure changes no custody, native data or receipt`);
      assert.deepEqual(await custodyEvidence(rt, cancelled), counts);
    };
    await refuseShared();
    const beforeCounts = await custodyEvidence(rt, people[0]);
    const stateBefore = await rt.db.prepare('SELECT epoch FROM rer_portability_state WHERE id=1').first();
    await erase(rt, people[0].email);
    assert.deepEqual(await rt.data(`/api/app/bookings/${peer.id}`), peerBefore);
    const journal = await assertErased(rt, people[0]);
    const afterCounts = await custodyEvidence(rt, people[0]);
    assert.ok((await rt.db.prepare('SELECT epoch FROM rer_portability_state WHERE id=1').first()).epoch > (stateBefore?.epoch ?? 0));
    for (const verb of ['UPDATE ik_d1_erasure_journal SET recorded_at=recorded_at', 'DELETE FROM ik_d1_erasure_journal', 'INSERT OR REPLACE INTO ik_d1_erasure_journal SELECT * FROM ik_d1_erasure_journal']) await assert.rejects(() => rt.db.prepare(verb).run());
    assert.deepEqual((await rt.db.prepare('SELECT * FROM ik_d1_erasure_journal').all()).results, journal);
    await rt.data(`/api/app/move-in/jobs/${imported.job.id}`);
    await refuseReplay(rt, imported.files);
    const undone = await finish(rt, await rt.data(`/api/app/move-in/jobs/${imported.job.id}/undo`, {}), 'undone');
    assert.equal(undone.job.erasedRecords > 0, true);
    assert.equal((await rt.db.prepare('SELECT count(*) AS n FROM bookings').first()).n, 0);
    await assertErased(rt, people[0]);
    await refuseShared();
    context.diagnostic(JSON.stringify({before:beforeCounts,afterErasure:afterCounts,peerUnchanged:true,afterUndo:await custodyEvidence(rt,people[0]),sharedSourceRefusedBeforeMutation:true,historicalCopies:2}));
  } finally { await rt.close(); }
});

contract('DATA-002', 'unrelated person erasure leaves imported custody and undo intact; retained edits refuse reimport without mutation', async () => {
  const rt = await bookingRuntime();
  try {
    const shared = people.map(person => ({...person,name:'Shared guest',answer:'Shared answer'}));
    const imported = await importPeople(rt, shared), before = await snapshot(rt.db);
    await erase(rt, 'unrelated-78321@example.test');
    const after = await snapshot(rt.db);
    for (const table of Object.keys(before).filter(name => name.startsWith('ik_'))) assert.deepEqual(after[table], before[table], table);
    const person = (await rt.data('/api/app/bookings')).find(row => row.inviteeEmail === people[1].email);
    await rt.data(`/api/app/bookings/${person.id}/attendance`, { status: 'attended', note: 'Retained authored annotation' });
    const undo = await finish(rt, await rt.data(`/api/app/move-in/jobs/${imported.job.id}/undo`, {}), 'undone');
    assert.ok(undo.undo.dispositions.some(row => row.disposition === 'retained'));
    const retained = await rt.data(`/api/app/bookings/${person.id}`);
    await refuseReplay(rt, imported.files);
    assert.deepEqual(await rt.data(`/api/app/bookings/${person.id}`), retained);
    // A shared name is not an identity: even a header with that name keeps its custody.
    const header = await rt.data('/__fixtures/import-header', {email:'Shared guest'});
    const headerBefore = await rt.db.prepare('SELECT * FROM ik_jobs WHERE id=?').bind(header.jobs[0]).first();
    // Once undo leaves the first person only in custody, HTTP privacy still erases it.
    await erase(rt, people[0].email);
    await assertErased(rt, {email:people[0].email});
    assert.deepEqual(await rt.data(`/api/app/bookings/${person.id}`), retained);
    assert.deepEqual(await rt.db.prepare('SELECT * FROM ik_jobs WHERE id=?').bind(header.jobs[0]).first(),headerBefore);
  } finally { await rt.close(); }
});

contract('DATA-002', 'header-only HTTP erasure retires real kit streams, scrubs revision anchors and explains all retired job routes', async context => {
  const rt = await bookingRuntime();
  try {
    const email = 'header-only-78321@example.test';
    const header = await rt.data('/__fixtures/import-header', { email });
    assert.ok(header.jobs.length);
    const anchor = await rt.db.prepare('SELECT * FROM ik_d1_stream_revisions WHERE stream_id=?').bind(header.streamId).first();
    assert.equal(anchor.operation_key, email);
    const before = await snapshot(rt.db);
    await rt.db.prepare("CREATE TRIGGER retirement_failure_probe AFTER INSERT ON ik_d1_erasure_journal BEGIN SELECT RAISE(ABORT,'synthetic retirement failure'); END").run();
    const preview = await rt.data('/api/app/privacy/preview', { email });
    const failure = await rt.api('/api/app/privacy/erase', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({email,confirmation:preview.confirmation,expiresAt:preview.expiresAt}) });
    assert.ok(failure.status >= 500); await failure.arrayBuffer();
    const afterFailure = await snapshot(rt.db);
    for (const table of Object.keys(before).filter(name => name.startsWith('ik_') || name.startsWith('rer_portability_'))) assert.deepEqual(afterFailure[table], before[table], `${table}: retirement/checkpoint rollback`);
    await rt.db.prepare('DROP TRIGGER retirement_failure_probe').run();
    assert.equal((await erase(rt, email)).localComplete, true);
    await assertErased(rt, {email});
    const retired = await rt.db.prepare('SELECT * FROM ik_d1_stream_revisions WHERE stream_id=?').bind(header.streamId).first();
    assert.equal(retired.namespace, ''); assert.equal(retired.operation_key, '');
    assert.ok(retired.progress_revision > anchor.progress_revision);
    assert.equal(retired.fingerprint, anchor.fingerprint);
    const retirements = (await rt.db.prepare('SELECT * FROM ik_d1_retirements').all()).results;
    assert.ok(retirements.some(row => row.kind === 'stream' && row.id === header.streamId));
    for (const job of header.jobs) for (const action of ['', '/resume', '/undo']) {
      const response = await rt.api(`/api/app/move-in/jobs/${job}${action}`, action ? {method:'POST'} : {});
      assert.equal(response.status, 410);
      const result = await response.json(); assert.equal(result.error.code, 'import_retired');
      assert.ok(retirements.some(row => row.receipt_id === result.error.receiptId));
    }
    for (const sql of ['UPDATE ik_d1_retirements SET retired_at=retired_at','DELETE FROM ik_d1_retirements','INSERT OR REPLACE INTO ik_d1_retirements SELECT * FROM ik_d1_retirements']) await assert.rejects(() => rt.db.prepare(sql).run());
    assert.deepEqual((await rt.db.prepare('SELECT * FROM ik_d1_retirements').all()).results, retirements);
    context.diagnostic(JSON.stringify({headerRetirement:await custodyEvidence(rt,{email}),retiredJobs:header.jobs.length,retiredStreams:1,readResumeUndoStatus:410,checkpointFailureRolledBack:true}));
  } finally { await rt.close(); }
});
