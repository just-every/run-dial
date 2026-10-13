import {fileURLToPath} from 'node:url';
import { privateDirectory } from './private-files.mjs';
import { localInstaller } from './adapter.mjs';
import { selectLocalState, LocalStateSafetyError } from './local/state.mjs';
import {operatorPrerequisites} from './operator-prerequisites.mjs';
import { installOperator } from './operator-install.mjs';
import { projectViteBinary } from './project-vite.mjs';
import { join, delimiter } from 'node:path';

export function operatorInstaller({ database, features, prepare, prepareData }) {
 const lifecycle=localInstaller({
  features, node: '22.20.0',
  failure: (error,{store})=>error instanceof LocalStateSafetyError ? store.redact(error.message) : undefined,
  async prepare(context) { context.localState = await selectLocalState(context.root); await privateDirectory(context.root, ['.wrangler', 'state']); await prepare?.(context); },
  prepareData,
  guard: async ({ root }) => { await selectLocalState(root); },
  secrets: {
   keepExisting: true, originKey: 'AUTH_ORIGIN',
   values: ({ origin }) => ({ AUTH_LOCAL: 'true', AUTH_ORIGIN: origin, MAIL_PROVIDER: 'development', MAIL_FROM: 'auth@localhost.test' }),
  },
  build: ['pnpm', ['run', 'build:app']],
  migrate: ['pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', database, '--local', '--persist-to', '.wrangler/state', '--config', 'dist/server/wrangler.json']],
  // Setup uses preview's production runtime behind the same public proxy.
  start: previewTarget,
  owner: { existingOwnerViaSignIn: true, displayName: input => input.displayName || 'Owner' },
  signIn: { emailKey: 'OWNER_EMAIL', returnTo: '/setup' },
 });
 return {...lifecycle,localPrerequisites:async({root,vars,email})=>vars.AUTH_LOCAL==='true'&&vars.MAIL_PROVIDER==='development'&&Boolean(vars.SESSION_SECRET)&&await operatorPrerequisites(root,email),install:(root,input,store,onApp,signal)=>installOperator(root,input,store,onApp,signal,lifecycle.hooks)};
}

// Only local runtimes receive the dev key; vite.config.ts passes it to `vite dev` alone.
// No runtime rer starts serves the Local Explorer: it reads and writes the store
// without the key. trafficProxy also refuses /cdn-cgi/* on the public listener.
const devBindings = (devKey, devLogin) => devKey ? { RER_DEV_KEY: devKey, RER_DEV_IDENTITY: devLogin ? 'off' : 'on' } : {};
const internalPort = port => { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A local runtime requires the traffic proxy internal port.'); return String(port); };
const developmentEnvironment = () => { const { RER_MODELS_SERVICE, RER_MODELS_KEY, ...env } = process.env; return env; };
export const developmentTarget = ({ root, origin, runtimePort, devKey, devLogin, modelsLive }) => [process.execPath, [projectViteBinary(root), 'dev', '--host', '127.0.0.1', '--port', internalPort(runtimePort), '--strictPort'], { env: { ...developmentEnvironment(), PATH: join(root, 'node_modules', '.bin') + delimiter + (process.env.PATH ?? ''), RER_DEV_ORIGIN: origin, WRANGLER_SEND_METRICS: 'false', X_LOCAL_EXPLORER: 'false', ...devBindings(devKey, devLogin), ...(modelsLive ? { RER_MODELS_SERVICE: modelsLive.baseUrl, RER_MODELS_KEY: modelsLive.apiKey } : {}) } }];

export const previewTarget = ({ origin, runtimePort, devKey, scheduled }) => [process.execPath, [fileURLToPath(new URL('./production-runtime.mjs', import.meta.url))], { env: { ...process.env, RER_DEV_ORIGIN: origin, RER_RUNTIME_HOST: '127.0.0.1', RER_RUNTIME_PORT: internalPort(runtimePort), WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', X_LOCAL_EXPLORER: 'false', RER_RUNTIME_TRIGGERS: scheduled ? '1' : '0', ...(devKey ? { RER_DEV_KEY: devKey } : {}) } }];
