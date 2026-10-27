import assert from 'node:assert/strict';
import { before, after } from 'node:test';
import { contract } from './contract.mjs';
import { fixture } from './request-json-boundary/fixture.mjs';

let f;
before(async () => { f = await fixture(); });
after(async () => { await f?.close(); });
const malformed = '{"url":"synthetic-private-body-value",';
const invalid = { error: { code: 'invalid_request', message: 'The request contains invalid fields.' } };

contract('AUTH-001', 'copy-report input validation rejects malformed JSON and wrong shapes without writes, then accepts the native report', async () => {
  async function step(title, run) {
    try { await run(); }
    catch (error) { error.message = `${title}: ${error.message}`; throw error; }
  }
  await step('malformed JSON is inert and sanitized', async () => {
    const before = await f.snapshot();
    for (const rawBody of [malformed, '', '{', '[1,']) {
      const response = await f.send(f.endpoint, { rawBody });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), invalid);
      assert.deepEqual(await f.snapshot(), before);
    }
    assert.deepEqual(before.effects, { mailCalls: 0, queueCalls: 0 });
  });
  await step('strict shapes are inert and a valid native report succeeds', async () => {
    const before = await f.snapshot();
    for (const body of [{ url: f.url, acceptedAt: '2000-01-01T00:00:00Z' }, { url: 1 }, {}, null]) {
      const response = await f.send(f.endpoint, { body });
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error.code, 'invalid_request');
      assert.ok(Array.isArray(result.error.details));
      assert.deepEqual(await f.snapshot(), before);
    }
    const response = await f.send(f.endpoint, { body: { url: f.url } });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.canonicalUrl, f.url);
    assert.equal(report.eventTypeId, before.host_link_copy_reports[0].event_type_id);
    assert.ok(Number.isFinite(Date.parse(report.acceptedAt)));
    assert.deepEqual(await (await f.send('/__fixture/effects')).json(), { mailCalls: 0, queueCalls: 0 });
  });
});

contract('BASE-ACCESS-002', 'copy-report session and Origin guards retain precedence over malformed JSON', async () => {
  const before = await f.snapshot();
  for (const [options, status, code] of [
    [{ anonymous: true }, 401, 'session_required'],
    [{ headers: { host: 'foreign.example.test' } }, 403, 'invalid_host'],
    [{ headers: { origin: 'https://foreign.example.test' } }, 403, 'origin_not_allowed'],
    [{ headers: { origin: '' } }, 403, 'origin_not_allowed'],
    [{ headers: { 'x-dial-copy-report': '' } }, 403, 'origin_not_allowed'],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403, 'origin_not_allowed'],
  ]) {
    const response = await f.send(f.endpoint, { rawBody: malformed, ...options });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual(await f.snapshot(), before);
  }
  assert.equal((await f.send(f.endpoint, { method: 'PUT', rawBody: malformed })).status, 404);
  assert.deepEqual(await f.snapshot(), before);
});

contract('BASE-SECRET-001', 'real D1 copy-report write failures remain sanitized server failures and preserve the saved report', async () => {
  const before = await f.snapshot();
  await f.db.prepare("CREATE TRIGGER fixture_copy_failure BEFORE INSERT ON host_link_copy_reports BEGIN SELECT RAISE(ABORT, 'synthetic-private-db-value'); END").run();
  try {
    const response = await f.send(f.endpoint, { body: { url: f.url } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'runtime_unavailable', message: 'The Worker could not process this request.' } });
    assert.deepEqual(await f.snapshot(), before);
  } finally { await f.db.prepare('DROP TRIGGER fixture_copy_failure').run(); }
});

contract('BASE-SECRET-001', 'only explicit Hono client exceptions become sanitized 400 errors while arbitrary internal faults stay 503', async () => {
  const before = await f.snapshot();
  for (const kind of ['syntax', 'status', 'http', 'client']) {
    const response = await f.send(`/api/app/__fixture/error/${kind}`);
    assert.equal(response.status, kind === 'client' ? 400 : 503);
    assert.equal(response.headers.get('x-private'), null);
    assert.deepEqual(await response.json(), kind === 'client' ? invalid : { error: { code: 'runtime_unavailable', message: 'The Worker could not process this request.' } });
    assert.deepEqual(await f.snapshot(), before);
  }
});

contract('AUTH-001', 'direct Base authentication input retains its 400, 413, 415 and method responses', async () => {
  const before = await f.snapshot();
  for (const [options, status, code] of [
    [{ rawBody: malformed }, 400, 'invalid_input'],
    [{ rawBody: 'x'.repeat(8193) }, 413, 'input_too_large'],
    [{ rawBody: malformed, headers: { 'content-type': 'text/plain' } }, 415, 'unsupported_media_type'],
    [{ method: 'GET' }, 405, 'method_not_allowed'],
  ]) {
    const response = await f.send('/auth/magic-link', options);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
    assert.deepEqual(await f.snapshot(), before);
  }
});
