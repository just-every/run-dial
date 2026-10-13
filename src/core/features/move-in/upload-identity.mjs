import { z } from 'zod';
import { opaqueToken, hashToken, constantEqual } from '../../../../modules/operator-auth/crypto.mjs';
const purpose = 'dial.move-in.upload.v1';
const lifetime = 30 * 60 * 1000;
const claims = z.object({
  version: z.literal(1), owner: z.string().min(1).max(100), session: z.string().min(1).max(100), source: z.string().regex(/^[a-f0-9]{64}$/u),
  asOf: z.string().datetime(), generation: z.number().int().nonnegative(),
  issuedAt: z.number().int(), expiresAt: z.number().int(),
  nonces: z.array(z.string().regex(/^[A-Za-z0-9_-]{43}$/u)).max(500),
}).strict();

/** Each source booking gets 256 fresh CSPRNG bits before review. These nonces
 * require the server secret to derive a manage capability; they are not tokens. */
export async function issueUploadIdentity(secret, binding) {
  const issuedAt = Date.now();
  const value = claims.parse({ version: 1, owner: binding.owner, session: binding.session, source: binding.source,
    asOf: binding.asOf, generation: binding.generation, issuedAt, expiresAt: issuedAt + lifetime,
    nonces: Array.from({ length: binding.bookingCount }, () => opaqueToken()) });
  const body = JSON.stringify(value);
  return { identity: `${body}.${await hashToken(secret, purpose, body)}`, nonces: value.nonces };
}

/** Native operator auth remains mandatory. This only proves the private upload
 * input was minted by this server for this owner and native session, exact source and review time. */
export async function verifyUploadIdentity(identity, secret, binding) {
  const refused = () => new Error('Upload review expired or changed. Select the saved files again and review a new upload.');
  if (typeof identity !== 'string' || identity.length > 32768) throw refused();
  const separator = identity.lastIndexOf('.'), body = identity.slice(0, separator), signature = identity.slice(separator + 1);
  if (separator < 1 || !constantEqual(signature, await hashToken(secret, purpose, body))) throw refused();
  let value;
  try { value = claims.parse(JSON.parse(body)); } catch { throw refused(); }
  const now = Date.now();
  if (value.owner !== binding.owner || value.session !== binding.session || value.source !== binding.source || value.asOf !== binding.asOf ||
      value.generation !== binding.generation || value.nonces.length !== binding.bookingCount ||
      value.issuedAt > now || value.expiresAt <= now || value.expiresAt - value.issuedAt !== lifetime) throw refused();
  return { identity, nonces: value.nonces };
}
