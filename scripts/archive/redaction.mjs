import { privateLinks, scrubPrivateLinks } from './private-links.mjs';
import { parseJsonText } from './json-values.mjs';
// SQLite capabilities are identified by their actual schema, not column substrings.
const credentialColumns = {
  workspace_notice_destinations: ["credential_ciphertext"],
  notice_oauth_states: ["id"],
  accounting_connections: ['access_token_ciphertext','refresh_token_ciphertext'],
  accounting_oauth_states: ['id'],
  magic_link_tokens: ['token_hash'], operator_sessions: ['token_hash'],
  calendar_connections: ['access_token_ciphertext', 'refresh_token_ciphertext', 'channel_id', 'channel_resource_id'],
  calendar_push_channels: ['provider_channel_id', 'provider_resource_id'],
  calendar_oauth_states: ['id'], booking_nonces: ['nonce_hash'], booking_manage_tokens: ['token_hash'],
  availability_request_review_nonces: ['nonce_hash'], availability_requests: ['nonce_hash'],
  oa_tokens: ['token_hash'], oa_sessions: ['token_hash'], oa_step_up_challenges: ['token_hash'],
  oa_owner_signins: ['token_hash'],
  booking_link_tokens: ['token_hash'],
};
// Exact field names in structured user data still identify embedded credentials.
// Normalize naming conventions only; secretary/tokenizer/cookieRecipe are data.
const credentialFields = new Set([
  'token', 'tokens', 'tokenhash', 'tokenciphertext', 'accesstoken', 'accesstokenhash', 'accesstokenciphertext',
  'refreshtoken', 'refreshtokenhash', 'refreshtokenciphertext', 'idtoken', 'authtoken', 'oauthtoken',
  'bearertoken', 'sessiontoken', 'setuptoken', 'csrftoken', 'xsrftoken', 'apitoken',
  'secret', 'secrets', 'clientsecret', 'sessionsecret', 'webhooksecret', 'apisecret', 'secretaccesskey',
  'password', 'passwords', 'credential', 'credentials', 'authorization', 'proxyauthorization',
  'cookie', 'cookies', 'setcookie', 'apikey', 'privatekey', 'signingkey', 'webhookkey', 'webhooksignature',
  'nonce', 'noncehash', 'ciphertext', 'manageurl', 'managelink',
]);
const sensitiveField = key => credentialFields.has(key.replaceAll(/[_-]/g, '').toLowerCase());
const commandKey = /^(?:wireMail|text|html|manage|mail|headers|body)$/i;
function commandField(key, value, container, secrets, commands) {
  if (!commands || !commandKey.test(key)) return false;
  // Nested text can be an ordinary diagnostic or template fact. A wire envelope,
  // another command field, or embedded capability identifies frozen mail text.
  if (key.toLowerCase() !== 'text' || commands === true) return true;
  if (Object.keys(container).some(name => /^(?:wireMail|html|manage|mail|headers|body|to|subject|recipientRole)$/i.test(name))) return true;
  return typeof value === 'string' && scrub(value, secrets) !== value;
}
function structured(value) {
  try { const parsed = parseJsonText(value); return typeof parsed === 'string' || parsed && typeof parsed === 'object' && !JSON.isRawJSON(parsed) ? parsed : undefined; }
  catch { return undefined; }
}
export function scrub(value, secrets = [], commands = false) {
  if (JSON.isRawJSON(value)) return value;
  if (Array.isArray(value)) return value.map(item => scrub(item, secrets, commands));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !sensitiveField(key) && !commandField(key, item, value, secrets, commands))
    .map(([key, item]) => [scrub(key, secrets), scrub(item, secrets, commands ? 'nested' : false)]));
  if (typeof value !== 'string') return value;
  const parsed = structured(value);
  if (parsed !== undefined) {
    const clean = scrub(parsed, secrets, commands);
    // Preserve whitespace, escaped characters and serialized user text verbatim
    // unless a redaction actually changed the parsed value.
    if (JSON.stringify(clean) !== JSON.stringify(parsed)) return JSON.stringify(clean);
  }
  let result = value;
  for (const secret of secrets) if (secret) result = result.replaceAll(secret, '[redacted]');
  return scrubPrivateLinks(result, secrets);
}
export function collectSecrets(tables, runtimeSecrets = []) {
  const values = new Set(); const strings = [];
  const hashes = new Set(tables.find(table => table.name === 'booking_manage_tokens')?.rows.map(row => row.token_hash) ?? []);
  function visit(value, sensitive = false) {
    if (JSON.isRawJSON(value)) return;
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) visit(item, sensitive && !/(?:_at|At)$/.test(key) || sensitiveField(key));
    } else if (typeof value === 'string' && value) {
      if (sensitive) values.add(value);
      strings.push({ value, sensitive });
      const parsed = structured(value);
      if (parsed !== undefined) visit(parsed, sensitive);
    }
  }
  for (const { name, rows } of tables) for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      const restoredNonce = name === 'availability_requests' && column === 'nonce_hash' && value === `restored:${row.id}`;
      visit(value, !restoredNonce && (credentialColumns[name]?.includes(column) ?? false));
    }
  }
  const known = [...values, ...runtimeSecrets];
  for (const { value, sensitive } of strings) for (const { link, token } of privateLinks(value, { known, hashes, trusted: sensitive })) {
    values.add(link); values.add(token);
  }
  return [...values].sort((a, b) => b.length - a.length);
}
