import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contract } from './contract.mjs';
import { fixture, testPlatform } from './archive/fixture.mjs';
import { createArchive as artifact } from './archive/artifact.mjs';
import { createArchive, restoreArchive } from './archive/artifact.mjs';
import { schemaModel } from '../scripts/archive/schema.mjs';

contract('DATA-001', 'actual archive round trips innocent JSON-looking user text and structured answers with exact whitespace and shared values', async () => {
  const source = await fixture(); const target = await schemaModel();
  try {
    const ordinary = 'ordinary shared value';
    const documentation = 'Read https://docs.example.test/manage/teams and /auth/confirm?topic=workflow. Keep surrounding text.';
    const biography = `  { "secretary": "${ordinary}", "tokenizer": "parser", "text": "\\u0068ello", "cookieRecipe": "oats", "documentation": ${JSON.stringify(documentation)} }\n`;
    const answer = ` \n${JSON.stringify(`\t{ "secretary" : "${ordinary}", "tokenizer" : "parser", "answer": "keep original formatting" }\n`)} `;
    source.db.prepare('UPDATE host_profiles SET biography=?, name=?').run(biography, ordinary);
    source.db.prepare('UPDATE booking_answers SET value_json=?').run(answer);
    const platform = testPlatform(source.db); const destination = testPlatform(target.db);
    const key = '/ordinary/secretary/🙂.json';
    const bytes = Buffer.from(` \n{ "secretary": "${ordinary}", "text": "\\u0068ello", "documentation": ${JSON.stringify(documentation)}, "payload": ${JSON.stringify(JSON.stringify({ nested: JSON.stringify({ documentation, text: 'ordinary serialized text' }) }))} }\t`);
    platform.objects.set(key, { bytes, contentType: 'application/json; charset=utf-8' });
    const archive = await artifact(platform); await restoreArchive(destination, archive);
    assert.deepEqual({ ...target.db.prepare('SELECT biography,name FROM host_profiles').get() }, { biography, name: ordinary });
    assert.equal(target.db.prepare('SELECT value_json FROM booking_answers').get().value_json, answer);
    assert.deepEqual(destination.objects.get(key), platform.objects.get(key));
    assert.deepEqual(await artifact(destination), archive);
  } finally { source.db.close(); target.db.close(); }
});

contract('BASE-SECRET-001', 'actual export refuses encoded JSON asset credentials across chunks and removes incomplete output without changing benign bytes', async () => {
  const source = await fixture(); const folder = await mkdtemp(join(tmpdir(), 'dial-json-secrets-'));
  const credential = 'synthetic-runtime-credential/0123456789-Å🙂';
  const escape = value => value.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  try {
    const platform = testPlatform(source.db); platform.knownSecrets = () => [credential];
    const encoded = [escape(credential), escape(credential).replace(/[a-f]/g, char => char.toUpperCase()), Array.from(credential).map((char, index) => index % 2 ? escape(char) : char).join('')];
    const variants = encoded.map(value => `{"nested":[{"text":"prefix ${value} suffix"}]}`);
    for (let depth = 1; depth <= 4; depth++) {
      let value = variants[0]; for (let index = 0; index < depth; index++) value = JSON.stringify({ payload: value });
      variants.push(value);
    }
    for (const [index, value] of variants.entries()) {
      const bytes = Buffer.from(value);
      let parsed = JSON.parse(bytes); while (parsed.payload) parsed = JSON.parse(parsed.payload);
      assert.ok(parsed.nested[0].text.includes(credential));
      assert.ok(!bytes.includes(Buffer.from(credential)));
      platform.objects.set('encoded/日本語.json', { bytes, contentType: 'application/json' });
      const path = join(folder, `rejected-${index}.dial`);
      await assert.rejects(createArchive(platform, path), /object-contains-credential/);
      await assert.rejects(access(path), { code: 'ENOENT' });
    }
  } finally { source.db.close(); await rm(folder, { recursive: true, force: true }); }
});
