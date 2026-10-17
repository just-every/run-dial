import { randomBytes, randomUUID } from 'node:crypto';
import { assert } from './validation.mjs';
import { query } from './migrations.mjs';
import { literal } from './migration-ledger.mjs';
import { readOwnerState, sameDeployment } from './owner.mjs';
import { activeWorker } from './worker.mjs';
import { OWNER_SIGNIN_PATH, OWNER_SIGNIN_SECONDS, ownerSigninDigest } from '../operator-auth/owner-signin-grant.mjs';

/** `rer signin`: with the same Cloudflare credentials that deployed this Worker, write a
 * one-time grant for the claimed owner into the deployment's own auth D1 and return the
 * link. Only the token's SHA-256 reaches the database; the token itself exists only in
 * the returned link. Refuses unless the live Worker is the one this record deployed. */
export async function ownerSignin({ api, target, statePath, clock = Date.now }) {
  const state = await readOwnerState(statePath, target);
  assert(state.receipt && !state.pendingUpload && !state.pendingSecret, 'missing-owner-receipt');
  const live = await activeWorker(api, target.worker);
  assert(live && sameDeployment(live, state.receipt.provider), 'owned-resource-replaced');
  const ids = Object.values(state.owned.d1).filter(entry => entry.status === 'created' && entry.id).map(entry => entry.id);
  const holding = [];
  for (const id of ids) if ((await query(api, id, "SELECT name FROM sqlite_master WHERE type='table' AND name='oa_owner_signins'"))[0].results.length) holding.push(id);
  if (!holding.length) throw Object.assign(new Error('owner-signin-unsupported'), { origin: target.origin });
  assert(holding.length === 1, 'owner-signin-ambiguous');
  const token = randomBytes(32).toString('base64url'), id = randomUUID(), now = clock();
  // The recorded owner: the claimed (bootstrap) owner first, as operator-auth's own owner() reads it.
  await query(api, holding[0], `INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at)
    SELECT ${literal(id)},${literal(await ownerSigninDigest(token))},o.id,o.version,${now},${now + OWNER_SIGNIN_SECONDS * 1000}
    FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.claim_id=o.id WHERE o.role='owner' AND o.status='active'
    ORDER BY b.claim_id IS NULL, o.created_at, o.id LIMIT 1`);
  const [owner] = (await query(api, holding[0], `SELECT o.email FROM oa_owner_signins g JOIN oa_operators o ON o.id=g.operator_id WHERE g.id=${literal(id)}`))[0].results;
  assert(owner, 'owner-not-claimed');
  const link = new URL(OWNER_SIGNIN_PATH, target.origin);
  link.searchParams.set('token', token);
  return { link: link.href, email: owner.email, expiresAt: now + OWNER_SIGNIN_SECONDS * 1000 };
}
