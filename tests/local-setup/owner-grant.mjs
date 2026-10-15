import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { ownerSigninDigest } from '../../modules/operator-auth/owner-signin-grant.mjs';
import { spawnOwned } from '../native-process/lifecycle.mjs';
import { environment } from './runtime.mjs';

/** The local D1 edge stands in for the owner tooling's authenticated D1 write. */
export async function ownerGrant(directory, email) {
 assert.match(email, /^[a-z0-9@._+-]+$/);
 const token = randomBytes(32).toString('base64url'), digest = await ownerSigninDigest(token), now = Date.now();
 const sql = `INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at)
  SELECT '${randomUUID()}','${digest}',id,version,${now},${now + 60_000} FROM oa_operators WHERE email='${email}' AND role='owner' AND status='active';`;
 const command = spawnOwned(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'dial-local', '--local', '--persist-to', '.wrangler/state', '--config', 'wrangler.toml', '--command', sql, '--json'], { cwd: directory, env: environment() }, { label: 'local owner grant fixture' });
 try { await command.waitForClose(60_000); }
 finally { await command.stop(); }
 return token;
}
