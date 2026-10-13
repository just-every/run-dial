import { localInstaller } from '../base-onboarding/adapter.mjs';
import { commandAdapter as createCommandAdapter } from '../base-cli/cli/adapter.mjs';
import { ownerDeploy } from '../base-cli/cli/deploy.mjs';
import { operatorPrerequisites } from '../base-onboarding/operator-prerequisites.mjs';
import { prepare, development, preview, temporary } from '../local/targets.mjs';
import { portability } from '../local/portability.mjs';
import { features } from './ui/seed.mjs';

export const lifecycle = localInstaller({
 features, node: '22.20.0', tools: ['node', 'pnpm'], prepare, prepareData: prepare,
 secrets: { keepExisting: true, originKey: 'APP_URL', values: ({ origin }) => ({ ENVIRONMENT: 'development', APP_URL: origin, MAIL_PROVIDER: 'development', MAIL_FROM: 'noreply@localhost.test' }) },
 build: ['pnpm', ['run', 'build:app']],
 migrate: ['pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'dial-local', '--local', '--persist-to', '.wrangler/state', '--config', 'dist/server/wrangler.json']],
 start: temporary,
 owner: { existingOwnerViaSignIn: true, displayName: input => input.displayName || 'Owner' },
 signIn: { returnTo: '/setup' },
});
export const { install } = lifecycle;
export const commandAdapter = createCommandAdapter(lifecycle, {
 site: { entry: "src/site/pages.tsx", output: "dist/site", declaration: "deploy-site.json", config: "vite.site.config.ts" },
 dev: development, preview, verify: ['pnpm', ['run', 'verify:app']], deploy: ownerDeploy('deploy.json', lifecycle), portability,
 localPrerequisites: async ({ root, vars, email }) => vars.ENVIRONMENT === 'development' && vars.MAIL_PROVIDER === 'development' && Boolean(vars.SESSION_SECRET) && await operatorPrerequisites(root, email),
 setup: { manifestFile: 'rer-setup.json' }, browserModule: 'scripts/installer/ui/seed.mjs', product: 'Dial',
 // Local dev identity: the local-only Worker entry, the build output rer build scans for the dev layer, and the kept end-to-end email-link test.
 devIdentity: { entry: 'src/server.dev.ts', output: ['dist'], emailLinkTest: 'tests/local-setup-journey.test.mjs' },
 localOnlyKeys: ['RER_DEV_ORIGIN', 'RER_DEV_IDENTITY'],
 input: { names: { name: 'displayName' } },
});
