import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contract } from './contract.mjs';
import { canonicalRow, collectSecrets } from '../scripts/archive/policy.mjs';
import { secretScanner, digestBody } from '../scripts/archive/streams.mjs';

contract('DATA-001', 'credential discovery preserves innocent keys, shared ordinary values and all untouched JSON string bytes', () => {
  const ordinary = 'ordinary shared wording';
  const values = [
    ` \n{ "secretary": "${ordinary}", "tokenizer": "tokenizer detail", "cookieRecipe":"oats", "passwordless":"topic", "credentialed":"qualified", "authorizationStatus":"accepted", "nonce_word":"word", "text":"keep" }\t`,
    '  { "text" : "plain text", "nested" : [ 1, 2, { "slash":"\\u002f", "emoji":"🙂" } ] }\n',
    '  "quoted biography with whitespace"\n',
    'plain text containing secretary, tokenizer, accessToken and cookies',
  ];
  for (const biography of values) {
    const answer = ` \n${JSON.stringify(biography)}\t`;
    const tables = [
      { name: 'host_profiles', rows: [{ biography, name: ordinary }] },
      { name: 'booking_answers', rows: [{ value_json: answer }] },
    ];
    const secrets = collectSecrets(tables);
    assert.deepEqual(secrets, []);
    for (const { name, rows } of tables) assert.deepEqual(canonicalRow(name, rows[0], secrets), rows[0]);
  }
});

contract('DATA-001', 'ordinary documentation URLs retain exact neighbouring text while actual percent-encoded capabilities are removed', () => {
  const ordinary = 'Read https://docs.example.test/manage/teams and /auth/confirm?topic=workflow. Keep this neighbouring text.';
  const source = { biography: ordinary, headline: 'https://docs.example.test/manage/teams' };
  assert.deepEqual(collectSecrets([{ name: 'host_profiles', rows: [source] }]), []);
  assert.deepEqual(canonicalRow('host_profiles', source), source);
  const token = 'A'.repeat(43);
  const links = [`https://dial.example.test/manage/${token}`, `/embed/manage/${token}`, `/api/public/manage/${token}/calendar.ics`, `/auth/confirm?%74oken=${token.split('').map(char => '%' + char.charCodeAt(0).toString(16)).join('')}`];
  for (const link of links) {
    const row = { biography: JSON.stringify(JSON.stringify({ documentation: ordinary, capability: `before ${link} after` })) };
    const secrets = collectSecrets([{ name: 'host_profiles', rows: [row] }]);
    assert.ok(secrets.includes(token));
    const result = JSON.parse(JSON.parse(canonicalRow('host_profiles', row, secrets).biography));
    assert.equal(result.documentation, ordinary);
    assert.match(result.capability, /^before \[(?:redacted|private-link-removed)\] after$/);
  }
  // Persisted/known capabilities are screened regardless of length; URL shape
  // is only needed when the source does not otherwise identify the material.
  const short = 'short-private-capability'; const salt = 'synthetic-source-runtime-salt';
  const token_hash = createHash('sha256').update(`${salt}:${short}`).digest('base64url');
  const tables = [{ name: 'booking_manage_tokens', rows: [{ token_hash }] }, { name: 'host_profiles', rows: [{ biography: `before /manage/${short} after` }] }];
  assert.ok(collectSecrets(tables, [salt]).includes(short));
});

contract('BASE-SECRET-001', 'digestBody screens multiple serialized JSON layers across chunks without buffering or rewriting benign serialization', async () => {
  const credential = 'nested-synthetic-private-credential/Å🙂-0123456789';
  const escape = value => value.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const stream = (bytes, width) => (async function* () { for (let index = 0; index < bytes.length; index += width) yield bytes.subarray(index, index + width); })();
  for (let depth = 1; depth <= 4; depth++) {
    let text = `{ "credential": "${escape(credential)}" }`;
    for (let layer = 0; layer < depth; layer++) text = JSON.stringify({ payload: text });
    let decoded = JSON.parse(text); for (let layer = 0; layer < depth; layer++) decoded = JSON.parse(decoded.payload);
    assert.equal(decoded.credential, credential);
    const bytes = Buffer.from(text); assert.ok(!bytes.includes(Buffer.from(credential)));
    for (const width of [1, 3, 17, bytes.length]) await assert.rejects(digestBody(stream(bytes, width), bytes.length, async () => {}, [credential]), /object-contains-credential/);
    const benign = Buffer.from(text.replaceAll('credential', 'example').replaceAll('006e', '006d'));
    const consumed = [];
    const digest = await digestBody(stream(benign, 1), benign.length, async bytes => { consumed.push(Buffer.from(bytes)); }, [credential]);
    assert.equal(digest, createHash('sha256').update(benign).digest('hex'));
    assert.deepEqual(Buffer.concat(consumed), benign);
  }
});

contract('BASE-SECRET-001', 'stream scanning rejects JSON Unicode escaped credentials across every split and preserves nonsecret escaped data', () => {
  const credential = 'Synthetic-Secret/with_Å🙂-0123456789';
  const escape = (value, upper = false) => value.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')[upper ? 'toUpperCase' : 'toLowerCase']()}`).join('');
  const variants = [escape(credential), escape(credential, true), Array.from(credential).map((char, index) => index % 2 ? escape(char) : char).join(''), escape(credential.slice(0, 10)) + credential.slice(10)];
  for (const encoded of variants) {
    const bytes = Buffer.from(`{ "nested": [ { "value": "prefix ${encoded} suffix" } ] }`);
    assert.ok(JSON.parse(bytes).nested[0].value.includes(credential));
    assert.ok(!bytes.includes(Buffer.from(credential)));
    for (let split = 0; split <= bytes.length; split++) {
      const scan = secretScanner([credential]);
      assert.throws(() => { scan(bytes.subarray(0, split)); scan(bytes.subarray(split)); }, /object-contains-credential/);
    }
    assert.throws(() => { const scan = secretScanner([credential]); for (const byte of bytes) scan(Buffer.from([byte])); }, /object-contains-credential/);
  }
  // Quotes end a token: adjacent JSON values cannot assemble a credential.
  const benign = Buffer.from(`{ "secretary" : "\\u0068ello 🙂", "values": [${credential.split('').map(JSON.stringify).join(',')}] }\n`);
  const original = Buffer.from(benign); const scan = secretScanner([credential]);
  for (const byte of benign) scan(Buffer.from([byte]));
  assert.deepEqual(benign, original);
});

contract('BASE-SECRET-001', 'exact nested credential fields and schema-owned capabilities redact their copies without treating diagnostic IDs as secrets', () => {
  const keys = ['accessToken', 'refresh_token', 'cookie', 'set-cookie', 'authorization', 'api_key', 'clientSecret', 'webhookSecret', 'password', 'credentials', 'nonceHash'];
  const credentials = keys.map((_, index) => `synthetic-private-value-${index}-0123456789`);
  const biography = JSON.stringify({ secretary: 'ordinary shared wording', tokenizer: 'ordinary parser detail', nested: Object.fromEntries(keys.map((key, index) => [key, credentials[index]])), text: 'preserved text' });
  const tables = [
    { name: 'host_profiles', rows: [{ biography }] },
    { name: 'calendar_oauth_states', rows: [{ id: 'synthetic-private-oauth-state-0123456789', operator_id: 'ordinary owner identity' }] },
    { name: 'calendar_connections', rows: [{ channel_id: 'synthetic-private-callback-0123456789', access_token_expires_at: '2099-01-01' }] },
  ];
  const secrets = collectSecrets(tables);
  for (const value of [...credentials, tables[1].rows[0].id, tables[2].rows[0].channel_id]) assert.ok(secrets.includes(value));
  for (const value of ['ordinary shared wording', 'ordinary parser detail', 'ordinary owner identity', '2099-01-01']) assert.ok(!secrets.includes(value));
  assert.deepEqual(collectSecrets([{ name: 'availability_requests', rows: [{ id: 'request', nonce_hash: 'restored:request' }] }]), []);
  assert.deepEqual(collectSecrets([{ name: 'host_profiles', rows: [{ biography: JSON.stringify({ accessToken: 'restored:actual-secret' }) }] }]), ['restored:actual-secret']);
  const clean = JSON.parse(canonicalRow('host_profiles', { biography }, secrets).biography);
  assert.deepEqual(clean, { secretary: 'ordinary shared wording', tokenizer: 'ordinary parser detail', nested: {}, text: 'preserved text' });
  for (const credential of secrets) assert.equal(canonicalRow('host_profiles', { biography: `copy ${credential}` }, secrets).biography, 'copy [redacted]');
  const serialized = JSON.stringify(JSON.stringify({ cookie: credentials[0], answer: 'keep this answer', text: 'keep structured text' }));
  assert.deepEqual(JSON.parse(JSON.parse(canonicalRow('booking_answers', { value_json: serialized }, secrets).value_json)), { answer: 'keep this answer', text: 'keep structured text' });
  const delivery = canonicalRow('delivery_outbox', { state: 'succeeded', payload_json: JSON.stringify({ wireMail: { text: 'frozen wire body', html: 'frozen wire HTML' }, text: 'legacy wire body', metadata: { text: 'retained diagnostic text', secretary: 'ordinary shared wording' } }) }, secrets);
  assert.deepEqual(JSON.parse(delivery.payload_json), { metadata: { text: 'retained diagnostic text', secretary: 'ordinary shared wording' }, archiveHistorical: true });
});

contract('DATA-001', 'a dev persona never travels active: its product row is exported removed, beside the auth row Base suspends', () => {
  const persona = { id: 'p', email: 'co-host@dev.localhost', normalized_email: 'co-host@dev.localhost', created_at: 'c', updated_at: 'u', removed_at: null };
  assert.equal(canonicalRow('operators', persona).removed_at, 'u');
  const real = { ...persona, id: 'r', email: 'owner@example.test', normalized_email: 'owner@example.test' };
  assert.deepEqual(canonicalRow('operators', real), real, 'a real operator is exported as it is');
});

contract('DATA-001', 'hosted export command retains bounded HTTP/archive and connection causes without exposing source text or credentials', async () => {
  const { hostedDiagnostics } = await import('./local-setup/hosted-diagnostics.mjs');
  await hostedDiagnostics();
});

contract('BASE-SECRET-001', 'hosted object refusals survive the published HTTP handler and real export command with safe causes and cleanup', async () => {
  const { hostedObjectRefusal } = await import('./archive/hosted-refusal.mjs');
  await hostedObjectRefusal();
});
