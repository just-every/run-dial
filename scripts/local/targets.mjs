import { previewTarget } from '@runeditrun/rer/operator-installer';
import { selectLocalState } from '@runeditrun/rer/local/state';
import { privateDirectory } from '@runeditrun/rer/private-files';
import { assertLegacyStateRecovered } from './legacy-state.mjs';
import { retireLocalObservability } from './observability.mjs';

export async function prepare({ root, signal }) {
 await selectLocalState(root);
 await assertLegacyStateRecovered(root);
 await privateDirectory(root, ['.wrangler', 'state']);
 await retireLocalObservability(root, '.wrangler/state', signal);
}
// Demo switches reach a runtime only from `rer demo`'s own context, never inherited from the shell.
const inherited = () => { const rest = { ...process.env }; for (const name of ['RER_DEMO', 'RER_DEMO_EXPIRES', 'RER_STATE_DIR']) delete rest[name]; return rest; };
const env = origin => ({ ...inherited(), RER_DEV_ORIGIN: origin, RER_ORIGIN_KEY: 'APP_URL', DIAL_DISABLE_INSPECTOR: '1', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', X_LOCAL_EXPLORER: 'false', X_LOCAL_OBSERVABILITY: 'false' });
// Only local runtimes receive the checkout's dev key; vite.config.ts hands it to `vite dev` alone and preview's production runtime keeps it as a binding.
const devBindings = (key, login) => key ? { RER_DEV_KEY: key, RER_DEV_IDENTITY: login ? 'off' : 'on' } : {};
// A demo's Vite persists to its own folder (vite.config.ts reads RER_STATE_DIR) and its Worker sees RER_DEMO=1 and the demo's end.
const demoBindings = demo => demo ? { RER_DEMO: '1', RER_DEMO_EXPIRES: demo.ends, RER_STATE_DIR: demo.state } : {};
export const development = ({ origin, runtimePort, devKey: key, devLogin, demo }) => ['pnpm', ['exec', 'vite', 'dev', '--host', runtimePort ? '127.0.0.1' : new URL(origin).hostname.replace(/^\[|\]$/g, ''), '--port', String(runtimePort ?? new URL(origin).port), '--strictPort'], { env: { ...env(origin), ...devBindings(key, devLogin), ...demoBindings(demo) } }];
// Setup and preview use the same production runtime: no bundler, Explorer or trigger handlers.
// Base selects the internal port when proxied and the origin port for temporary setup.
export const preview = async context => {
 await prepare(context);
 const [command, args, options] = previewTarget(context);
 return [command, args, { ...options, env: { ...env(context.origin), ...options.env, RER_ORIGIN_KEY: 'APP_URL', DIAL_DISABLE_INSPECTOR: '1', X_LOCAL_OBSERVABILITY: 'false' } }];
};
export const temporary = preview;
