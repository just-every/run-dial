import { createHash } from 'node:crypto';
export { environmentSecrets } from './environment-secrets.mjs';
export function transportSecrets(token) { return [token, createHash('sha256').update(token).digest('hex')]; }
