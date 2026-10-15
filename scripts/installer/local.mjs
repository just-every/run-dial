import { localInstaller } from '@runeditrun/rer/local-installer';
import { commandAdapter as createCommandAdapter } from '@runeditrun/rer/adapter';
import { ownerDeploy } from '@runeditrun/rer/deploy';
import { operatorPrerequisites } from '@runeditrun/rer/operator-prerequisites';
import { prepare, development, preview, temporary } from '../local/targets.mjs';
import { portability } from '../local/portability.mjs';
import { features } from './ui/seed.mjs';
import { assertLegacyStateRecovered } from '../local/legacy-state.mjs';
import { refuse } from '@runeditrun/rer/errors';

export const lifecycle = localInstaller({
 features, node: '22.20.0', tools: ['node', 'pnpm'], prepare, prepareData: prepare,
 secrets: { keepExisting: true, originKey: 'APP_URL', values: ({ origin }) => ({ ENVIRONMENT: 'development', APP_URL: origin, MAIL_PROVIDER: 'development', MAIL_FROM: 'noreply@localhost.test' }) },
 build: ['pnpm', ['run', 'build:app']],
 // A demo (`rer demo`) migrates its own fresh state folder, never the checkout's.
 migrate: ({ demo }) => ['pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'dial-local', '--local', '--persist-to', demo?.state ?? '.wrangler/state', '--config', 'dist/server/wrangler.json']],
 start: temporary,
 owner: { existingOwnerViaSignIn: true, displayName: input => input.displayName || 'Owner' },
 signIn: { returnTo: '/setup' },
});
export const { install } = lifecycle;
export const commandAdapter = createCommandAdapter(lifecycle, {
 // @runeditrun/rer awaits this before reset inventory or removal.
 async resetPreflight({ root }) {
  try { await assertLegacyStateRecovered(root); }
  catch { throw refuse('Legacy Dial build/setup storage remains or cannot be inspected. Stop the old runtime and recover its original .dev.vars and data before removing the empty legacy directory; no data was changed.'); }
 },
 site: { entry: "src/site/pages.tsx", output: "dist/site", declaration: "deploy-site.json", config: "vite.site.config.ts" },
 dev: development, preview, verify: ['pnpm', ['run', 'verify:app']], deploy: ownerDeploy('deploy.json', lifecycle), portability,
 // A demo claims the saved owner in its own state, so it never opens the checkout's database (even a read rewrites SQLite's -shm).
 localPrerequisites: async ({ root, vars, email, demo }) => vars.ENVIRONMENT === 'development' && vars.MAIL_PROVIDER === 'development' && Boolean(vars.SESSION_SECRET) && (demo || await operatorPrerequisites(root, email)),
 setup: { manifestFile: 'rer-setup.json' }, browserModule: 'scripts/installer/ui/seed.mjs', product: 'Dial',
 // Local dev identity: the local-only Worker entry, the build output rer build scans for the dev layer, and the kept end-to-end email-link test.
 devIdentity: { entry: 'src/server.dev.ts', output: ['dist'], emailLinkTest: 'tests/local-setup-journey.test.mjs' },
 localOnlyKeys: ['RER_DEV_ORIGIN', 'RER_DEV_IDENTITY'],
 input: {
  names: { name: 'displayName' },
  defaults: () => ({ MAIL_PROVIDER: 'development', MAIL_FROM: 'noreply@localhost.test' }),
 },
});
