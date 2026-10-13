import { parseEnv } from 'node:util'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// The shared loopback predicate, beside this copy in Base or in a seed's scripts/.
const portable = basename(dirname(dirname(fileURLToPath(import.meta.url)))) === 'base-onboarding'
const { isLocalhostName } = await import(new URL(portable ? '../../base-cli/modules/operator-auth/loopback.mjs' : '../../modules/operator-auth/loopback.mjs', import.meta.url))

export function localVariables(text) {
  // Node's dotenv parser can consume the next assignment after an unquoted
  // whitespace-only value. Keep such values empty for the preflight checks.
  return parseEnv(text.replace(/(^[\t ]*(?:export[\t ]+)?[A-Za-z_]\w*[\t ]*=)[\t ]+(?=\r?$)/gm, '$1'))
}

// Inherited application bindings never reach a build or migration command.
// The default names are the Base operator-auth and mail bindings.
export const applicationBindings = /^(SESSION_SECRET|SETUP_TOKEN|OWNER_EMAIL|AUTH_|MAIL_|OIDC_|AI_|MODELS_|RER_MODELS_)/

export function buildEnvironment(bindings = applicationBindings, inherited = process.env) {
  const env = { ...inherited, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', WRANGLER_SEND_METRICS: 'false' }
  const declared = Array.isArray(bindings) ? new Set(bindings) : null
  for (const key of Object.keys(env)) if (declared ? declared.has(key) || applicationBindings.test(key) : bindings.test(key)) delete env[key]
  return env
}

// Values printed by a child are redacted when their name marks a credential.
export const secretValues = (vars) => Object.entries(vars).filter(([key]) => /SECRET|TOKEN|API_KEY/.test(key)).map(([, value]) => value).filter(Boolean)

export function localOrigin(vars) {
  let url
  try { url = new URL(vars.AUTH_ORIGIN) } catch { /* Use a fixed, non-secret diagnostic. */ }
  if (vars.AUTH_LOCAL !== 'true' || !url || url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && !isLocalhostName(url.hostname)) || url.origin !== vars.AUTH_ORIGIN || url.username || url.password) {
    throw new Error('Invalid local origin in .dev.vars: AUTH_ORIGIN must be http://127.0.0.1:PORT (or a front-door http://NAME.localhost:PORT) with AUTH_LOCAL=true. Run rer setup to save a valid one. If you changed AUTH_ORIGIN yourself, put back the http://127.0.0.1:PORT origin setup saved, or pick a port with rer setup --port PORT.')
  }
  return url
}
