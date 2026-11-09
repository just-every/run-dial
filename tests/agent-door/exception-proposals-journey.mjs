import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveHosted, HOSTED_ORIGIN } from '@runeditrun/rer/internal/cli/hosted-output.mjs';
import { accessToken, autonomousPolicy, signJws, seconds } from '../../modules/agent-door/conformance/crypto.mjs';
import { createProtocol, errorCode } from '../../modules/agent-door/conformance/protocol.mjs';
import { auditRows } from '../../modules/agent-door/conformance/audit-rows.mjs';
import { evidencePath } from '../../scripts/evidence-path.mjs';
import { profile, eventInput } from './native-owner.mjs';

const proposalTool = 'dial.requests.exception_proposals';
const email = number => [`synthetic-dial-${number}`, 'example.invalid'].join('@');
const windows = (startMinute, endMinute) => Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute, endMinute }));

// Run through the built production Worker and actual Core transport. This
// installation has no scheduling execution grant or connected calendar.
export default async function exceptionProposalsJourney() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'));
  const origin = HOSTED_ORIGIN, token = randomUUID(), kid = randomUUID(), installationId = randomUUID();
  const issuer = 'https://synthetic-dial-issuer.invalid', ownerEmail = surface.verification.owner.email;
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeys = JSON.stringify({ [kid]: { ...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid, alg: 'ES256', use: 'sig' } });
  const sender = email('sender');
  let providerCalls = 0;
  console.log('Exception proposal journey: starting production runtime.');
  const hosted = await serveHosted(process.cwd(), { bindings: {
    OWNER_EMAIL: ownerEmail, SETUP_TOKEN: token, RER_OWNER_CLAIM_ISSUER: issuer,
    RER_OWNER_CLAIM_INSTALLATION_ID: installationId, RER_OWNER_CLAIM_APP_ORIGIN: origin,
    RER_OWNER_CLAIM_PUBLIC_KEYS: publicKeys, MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: token,
    MAIL_FROM: sender, MAIL_WEBHOOK_KEY: token,
  }, outboundService: async request => {
    providerCalls++;
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://api.sendgrid.com');
    if (url.pathname === '/v3/mail/send' && request.method === 'POST') {
      const message = await request.json();
      assert.equal(message.from?.email, sender);
      assert.ok(message.personalizations.every(item => item.to.every(recipient => recipient.email.endsWith('example.invalid'))));
      return new Response(null, { status: 202, headers: { 'x-message-id': randomUUID() } });
    }
    assert.equal(request.method, 'GET', 'only native fixture mail and sender readiness may contact the synthetic provider');
    if (url.pathname === '/v3/verified_senders') return Response.json({ results: [{ id: 1, from_email: sender, verified: true }] });
    if (url.pathname === '/v3/whitelabel/domains') return Response.json([]);
    assert.fail('Unexpected provider request during read-only exception journey');
  } });
  try {
    console.log('Exception proposal journey: production runtime ready.');
    const request = (absolute, init = {}) => {
      const url = new URL(absolute); assert.equal(url.origin, origin);
      return hosted.fetch(url.href.slice(origin.length + 1), { ...init, headers: Object.fromEntries(new Headers(init.headers)) });
    };
    const iat = seconds();
    const signed = await signJws(pair.privateKey, kid, 'rer-owner-claim+jwt', { v: 1, iss: issuer, aud: origin, installationId, email: ownerEmail, jti: randomUUID(), iat, exp: iat + 300 });
    const owner = await request(origin + '/auth/owner-claim', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: signed, displayName: profile.name, returnTo: '/app' }) });
    assert.equal(owner.status, 303, 'claim the fresh production installation through native authority');
    const cookie = owner.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    await owner.body?.cancel();
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
    const data = async (path, body, expected = 200, method = body === undefined ? 'GET' : 'POST', publicRead = false) => {
      console.log('Exception proposal journey native step:', method, path.split('?')[0]);
      const response = await request(origin + path, { method, headers: publicRead ? { Origin: origin, 'Content-Type': 'application/json' } : headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = response.status === 204 ? (await response.body?.cancel(), null) : await response.json();
      assert.equal(response.status, expected, `${method} ${path.split('?')[0]} HTTP ${response.status}`);
      return result;
    };
    const db = await hosted.database('DB');
    await data('/api/app/profile', profile, 200, 'PATCH');
    const identity = await db.prepare("SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'").first();
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin, sub: installationId, business: 'synthetic-dial-1', email: ownerEmail, owner_id: identity.operator_id, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null });
    await data('/api/rer/business-settings', { settings });
    await data('/api/app/hours/closures', { blockUsHolidays: false, reopenedHolidays: [], timeOff: [] }, 200, 'PUT');
    const yours = (await data('/api/app/hours')).yours;
    await data(`/api/app/availability-schedules/${yours.id}`, { name: 'Your hours', windows: windows(540, 1020), blockUsHolidays: false, reopenedHolidays: [], timeOff: [] }, 200, 'PUT');
    const event = await data('/api/app/event-types', { ...eventInput('synthetic-dial-exception'), availability: windows(540, 600) }, 201);
    await data(`/api/app/event-types/${event.id}/publish`, {});
    // Far from either date boundary, every weekday has the same saved hours.
    const date = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const body = { inviteeName: 'Synthetic requester', inviteeEmail: email(201), inviteeTimezone: 'UTC', note: 'Please consider my stated windows.', windows: [{ date, startMinute: 600, endMinute: 690 }] };
    const reviewPath = `/api/public/events/${profile.handle}/${event.slug}/request`;
    const review = await data(reviewPath + '/review', body, 201, 'POST', true);
    await data(reviewPath + '?nonce=' + encodeURIComponent(review.nonce), body, 201, 'POST', true);
    const requests = await data('/api/app/availability-requests');
    const nativeRequest = requests.find(item => item.eventTypeId === event.id);
    assert.ok(nativeRequest?.id, 'public review and submit create a real stored request');
    const readPath = `/api/app/availability-requests/${nativeRequest.id}/exception-proposals`;
    const context = createProtocol({ fetch: request, origin, surface, signer: { issuer, installationId, kid, privateKey: pair.privateKey }, person: { email: ownerEmail, cookie, sub: identity.operator_id }, business: 'synthetic-dial-1', consent: randomUUID(), agentId: 'synthetic-dial-exception-reader', seq: 0, revision: 0, points: [] });
    // Retain all scheduling, hold, nonce, outbound and accounting state. Only
    // the established authentication and Core policy or audit tables may vary.
    const snapshot = async () => {
      const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'oa_%' AND name NOT LIKE 'agent_door_%' AND name<>'public_rate_events' AND name<>'dial_portability_admission' ORDER BY name").all()).results;
      const rows = {};
      for (const { name } of tables) rows[name] = (await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results;
      return rows;
    };
    const drainFixtureWork = async () => {
      const deadline = Date.now() + 15_000;
      while (true) {
        const pending = await db.prepare("SELECT (SELECT count(*) FROM delivery_outbox WHERE state IN ('pending','processing') AND next_attempt_at<=?) + (SELECT count(*) FROM dial_portability_admission) AS count").bind(new Date().toISOString()).first();
        if (!pending.count) break;
        assert.ok(Date.now() < deadline, 'native fixture delivery and admissions must finish before read-only proof');
        await new Promise(done => setTimeout(done, 50));
      }
    };
    await drainFixtureWork();
    const before = await snapshot(), callsBefore = providerCalls;
    const unset = await context.tool(proposalTool, { id: nativeRequest.id });
    assert.equal(errorCode(unset), 'policy_unset');
    await context.adopt(autonomousPolicy());
    const toolInventory = await context.mcp('tools/list');
    const declared = toolInventory.result.tools.find(item => item.name === proposalTool);
    assert.equal(declared.annotations.readOnlyHint, true);
    const http = await data(readPath);
    assert.equal(http.advisory, true);
    assert.equal(http.requestId, nativeRequest.id);
    assert.equal(http.eventTypeId, event.id);
    assert.equal(http.hostTimezone, 'UTC'); assert.equal(http.inviteeTimezone, 'UTC');
    assert.deepEqual(http.proposals.map(item => item.startAt), [10, 10.5, 11].map(hour => `${date}T${String(Math.floor(hour)).padStart(2, '0')}:${hour % 1 ? '30' : '00'}:00.000Z`));
    for (const item of http.proposals) {
      assert.equal(Date.parse(item.endAt) - Date.parse(item.startAt), 30 * 60_000);
      assert.equal(item.tradeOff.kind, 'outside_event_recurring_hours');
      assert.ok(item.tradeOff.publishedWindows.length > 0);
      assert.equal(item.tradeOff.hostHours.scheduleId, yours.id);
      assert.deepEqual(item.tradeOff.inviteeWindow, body.windows[0]);
      assert.equal(item.hostDate, date); assert.equal(typeof item.hostOffset, 'string');
      for (const key of ['nonce', 'manageUrl', 'holdId', 'offeredLink', 'token']) assert.equal(Object.hasOwn(item, key), false);
    }
    assert.equal(http.sources.calendar, 'not_connected');
    assert.equal(http.sources.hostHours.id, yours.id);
    assert.equal(http.sources.event.id, event.id);
    assert.equal(http.sources.request.id, nativeRequest.id);
    for (let repeat = 0; repeat < 3; repeat++) {
      const mcp = await context.tool(proposalTool, { id: nativeRequest.id });
      assert.notEqual(mcp.result?.isError, true);
      assert.deepEqual(mcp.result.structuredContent, http, 'owner HTTP and actual Core MCP read the same service result');
      assert.deepEqual(await data(readPath), http);
    }
    const noScope = await context.tool(proposalTool, { id: nativeRequest.id }, { token: await accessToken(context, { scope: 'events:read' }) });
    assert.equal(noScope.status, 403); assert.equal(errorCode(noScope), 'insufficient_scope');
    const anonymousMcp = await context.tool(proposalTool, { id: nativeRequest.id }, { token: null });
    assert.equal(anonymousMcp.status, 401);
    const anonymousHttp = await request(origin + readPath);
    assert.equal(anonymousHttp.status, 401); await anonymousHttp.body?.cancel();
    const deniedPolicy = autonomousPolicy(); deniedPolicy.rules.push({ id: 'no-sensitive', class: 'sensitive', do: 'blocked' });
    await context.adopt(deniedPolicy);
    assert.equal(errorCode(await context.tool(proposalTool, { id: nativeRequest.id })), 'policy_blocked');
    await context.adopt(autonomousPolicy(), { revoked: { agents: [], consents: [context.consent] } });
    assert.equal((await context.tool(proposalTool, { id: nativeRequest.id })).status, 401, 'revoked consent cannot read stored invitee windows');
    await context.adopt(autonomousPolicy());
    assert.deepEqual(await snapshot(), before, 'repeated reads and authority refusals create no booking, nonce, hold, offered link, send or command');
    assert.equal(providerCalls, callsBefore, 'advisory reads contact no provider and run no recovery');
    const audited = await auditRows(context);
    assert.equal(audited.differs, 0, 'existing policy audit remains consistent');
    assert.equal(audited.rows.length, context.calls.length, 'each admitted or refused tool read retains its existing Core audit');
    const completed = audited.rows.filter(row => row.tool === proposalTool && row.outcome === 'done');
    assert.equal(completed.length, 3);
    assert.ok(completed.every(row => row.classes.some(item => item.class === 'sensitive')));
    assert.ok(audited.rows.some(row => row.code === 'policy_blocked'));
    assert.ok(audited.rows.some(row => row.code === 'policy_unset'));
    // Native public admission on a separate ordinary event creates a fresh
    // conflict; both advisory doors must immediately remove the occupied time.
    const control = await data('/api/app/event-types', { ...eventInput('synthetic-dial-control'), availability: windows(540, 1020) }, 201);
    await data(`/api/app/event-types/${control.id}/publish`, {});
    const selection = { startAt: http.proposals[0].startAt, inviteeTimezone: 'UTC' };
    const publicBase = `/api/public/book/${profile.handle}/${control.slug}`;
    const chosen = await data(publicBase + '/selection', selection, 201, 'POST', true);
    await data(publicBase + '/confirm', { ...selection, nonce: chosen.nonce, name: 'Synthetic control', email: email(202), answers: {} }, 201, 'POST', true);
    await drainFixtureWork();
    const occupied = await snapshot(), afterConflictCalls = providerCalls;
    const refreshed = await data(readPath), freshMcp = await context.tool(proposalTool, { id: nativeRequest.id });
    assert.equal(refreshed.proposals.some(item => item.startAt === selection.startAt), false);
    assert.equal(refreshed.proposals.length, 2);
    assert.deepEqual(freshMcp.result?.structuredContent, refreshed);
    assert.deepEqual(await snapshot(), occupied);
    assert.equal(providerCalls, afterConflictCalls);
    // Proposal output carries no native confirmation capability.
    const noNonce = await data(publicBase + '/confirm', { startAt: http.proposals[1].startAt, inviteeTimezone: 'UTC', name: 'Synthetic requester', email: email(201), answers: {} }, 404, 'POST', true);
    assert.equal(noNonce.error.code, 'booking_nonce_not_found');
    assert.deepEqual(await snapshot(), occupied, 'advisory times alone cannot create a native booking');
    assert.equal(providerCalls, afterConflictCalls);
    await data(`/api/app/event-types/${event.id}/guests`, { guestLimit: 1 }, 200, 'PUT');
    await drainFixtureWork();
    const unsupportedState = await snapshot(), unsupportedCalls = providerCalls;
    assert.equal((await data(readPath, undefined, 409)).error.code, 'exception_proposals_unsupported');
    assert.equal(errorCode(await context.tool(proposalTool, { id: nativeRequest.id })), 'exception_proposals_unsupported');
    assert.deepEqual(await snapshot(), unsupportedState, 'unsupported guest configurations refuse without scheduling effects');
    assert.equal(providerCalls, unsupportedCalls);
    await data(`/api/app/event-types/${event.id}/guests`, { guestLimit: 0 }, 200, 'PUT');
    // Revoking the original person session closes the owner HTTP read door.
    await data('/api/auth/sign-out', {}, 204);
    const revokedHttp = await request(origin + readPath, { headers });
    assert.equal(revokedHttp.status, 401); await revokedHttp.body?.cancel();
    const receipt = { nativeRequest: true, proposalCount: http.proposals.length, matchingDoors: true, repeatedReadOnly: true,
      freshConflictRemoved: true, remainingProposals: refreshed.proposals.length, anonymousRefused: true,
      unsupportedRefused: true, missingScopeRefused: true, blockedPolicyRefused: true, revokedConsentRefused: true, revokedSessionRefused: true,
      noSchedulingAuthority: true, readAudits: completed.length, policyAuditDifferences: audited.differs,
      providerCallsDuringReads: 0 };
    const receiptPath = evidencePath('exception-proposals-mcp-receipt.json');
    await mkdir(resolve(receiptPath, '..'), { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    console.log('Exception proposal journey: three native owner and MCP proposals agree; fresh conflicts, authority, read audit and no scheduling effects pass.');
    return receipt;
  } catch (error) { console.error('Exception proposal journey failed:', error); throw error; }
  finally { await hosted.close(); }
}
