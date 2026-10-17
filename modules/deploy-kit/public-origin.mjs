import { assert, identifier } from './validation.mjs';

// This public setting changes only originVar, never the deployment target.
export function publicOrigin(declaration, env = {}) {
  const setting = declaration.publicOriginSetting;
  if (setting === undefined) return undefined;
  assert(identifier(setting) && identifier(declaration.originVar), 'invalid-public-origin-setting');
  const value = env[setting];
  if (value === undefined) return undefined;
  // Check the input as well as URL's result: URL normalizes away empty query,
  // fragment, dot paths, backslashes and whitespace that must be refused.
  assert(typeof value === 'string' && /^https:\/\/(?:\[[0-9a-fA-F:.]+\]|[^:/?#@\\\s]+)(?::[0-9]+)?$/.test(value), 'invalid-public-origin');
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid-public-origin'); }
  assert(url.protocol === 'https:' && url.hostname && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'invalid-public-origin');
  return url.origin;
}
