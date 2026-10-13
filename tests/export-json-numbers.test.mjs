import assert from 'node:assert/strict';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { createArchive } from './archive/artifact.mjs';
import { restoreArchive } from './archive/artifact.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';
import { canonicalRow, collectSecrets } from '../scripts/archive/policy.mjs';

const numbers = '{"overflow":1e309,"precise":9007199254740993,"fraction":0.12345678901234567890123456789,"negativeZero":-0,"exponent":1.2300e+12}';
const text = '  ordinary user text\n\twith whitespace, secretary and tokenizer  ';
const credential = 'synthetic-numeric-neighbor-private-value';

contract('DATA-001', 'historical tagging and nested credential scrubbing preserve nonsecret JSON numeric spellings and user text', () => {
  const nested = ` \n{ "metadata": ${numbers}, "text": ${JSON.stringify(text)}, "accessToken": ${JSON.stringify(credential)} }\t`;
  const payload_json = ` { "metadata": ${numbers}, "serialized": ${JSON.stringify(nested)}, "description": ${JSON.stringify(text)}, "wireMail": { "text": "historical wire command" }, "credentials": ${JSON.stringify(credential)} } `;
  const row = { state: 'pending', payload_json };
  const secrets = collectSecrets([{ name: 'delivery_outbox', rows: [row] }]);
  assert.ok(secrets.includes(credential));
  const result = canonicalRow('delivery_outbox', row, secrets); const payload = JSON.parse(result.payload_json);
  assert.ok(result.payload_json.includes(numbers)); assert.ok(payload.serialized.includes(numbers));
  assert.equal(payload.description, text); assert.equal(JSON.parse(payload.serialized).text, text);
  assert.equal(payload.archiveHistorical, true); assert.equal(payload.wireMail, undefined);
  assert.equal(result.state, 'failed'); assert.equal(result.last_error_code, 'restored_historical_command');
  assert.equal(result.payload_json.includes(credential), false);
  assert.deepEqual(canonicalRow('delivery_outbox', result), result);
  const untouched = ` \n{ "metadata" : ${numbers}, "text" : ${JSON.stringify(text)} }\t`;
  assert.equal(canonicalRow('host_profiles', { biography: untouched }).biography, untouched);
  assert.equal(canonicalRow('booking_answers', { value_json: JSON.stringify(untouched) }).value_json, JSON.stringify(untouched));
});

contract('DATA-001', 'actual export restore reexport retains structured numeric facts alongside credential removal and historical markers', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const biography = ` \n{ "metadata": ${numbers}, "text": ${JSON.stringify(text)} }\t`;
    const payload = `{"metadata":${numbers},"description":${JSON.stringify(text)},"nested":{"accessToken":${JSON.stringify(credential)},"keep":${numbers}},"copy":${JSON.stringify('before ' + credential + ' after')}}`;
    source.db.prepare('UPDATE host_profiles SET biography=?').run(biography);
    source.db.prepare('UPDATE booking_answers SET value_json=?').run(JSON.stringify(biography));
    source.db.prepare('UPDATE delivery_outbox SET payload_json=?').run(payload);
    const archive = await createArchive(testPlatform(source.db)); const destination = testPlatform(target.db);
    await restoreArchive(destination, archive);
    const restored = target.db.prepare('SELECT payload_json,state FROM delivery_outbox').get();
    assert.ok(restored.payload_json.includes(numbers)); assert.ok(restored.payload_json.includes(`"keep":${numbers}`));
    const parsed = JSON.parse(restored.payload_json);
    assert.equal(parsed.archiveHistorical, true); assert.equal(restored.state, 'failed');
    assert.equal(parsed.description, text); assert.equal(parsed.copy, 'before [redacted] after');
    assert.equal(restored.payload_json.includes(credential), false);
    assert.equal(target.db.prepare('SELECT biography FROM host_profiles').get().biography, biography);
    assert.equal(target.db.prepare('SELECT value_json FROM booking_answers').get().value_json, JSON.stringify(biography));
    assert.deepEqual(await createArchive(destination), archive);
  } finally { source.db.close(); target.db.close(); }
});
