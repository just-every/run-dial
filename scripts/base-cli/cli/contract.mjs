export const pins = Object.freeze({ node: '22.20.0', pnpm: '10.12.4' });
// What a server start applies when the person sets nothing (RER_SERVER_LIMIT,
// RER_SERVER_IDLE_SECONDS or --idle-timeout). describe reports them.
export const serverDefaults = Object.freeze({ serverLimit: 10, idleSeconds: 43200 });
export const commonFlags = ['--help', '--cwd', '--non-interactive', '--json'];
const definitions = {
 install: [[], 'Frozen dependency installation; no setup or global tool changes.'],
 setup: [['--owner-email', '--owner-name', '--port', '--host', '--answers', '--door'], 'Build, migrate, prepare private settings and first owner; stop the temporary app. --door sets a fresh checkout up at its front-door origin http://NAME.localhost:PORT (after rer door enable).'],
 dev: [['--port', '--host', '--idle-timeout', '--stop', '--as', '--login', '--models', '--models-service', '--door', '--direct'], 'Foreground development with assets, HMR and the declared scheduled triggers run locally on their schedule. With devIdentity it opens signed in as the owner (--as PERSONA picks another start, --login uses the outbox sign-in instead); otherwise ordinary owner sign-in through the outbox. --door moves this checkout to its front-door origin http://NAME.localhost:PORT, keeping its data; --direct moves it back; --port and --host serve directly.'],
 preview: [['--port', '--host', '--idle-timeout', '--stop'], 'Foreground fixed production output; reuse intact build, preserve owner/state, idle timeout and explicit stop.'],
 build: [['--site'], 'Production build with private local settings excluded and restored. --site instead writes the static run site (homepage, /run, docs) to its declared folder and prints that folder.'],
 verify: [[], 'Run the complete internal verification target.'],
 reset: [['--yes'], 'Confirmed removal of the declared local inventory only.'],
 deploy: [['--environment', '--dry-run', '--site', '--host', '--env-file', '--image', '--bind-address', '--http-port', '--https-port'], 'Owner-account deployment and health; dry run performs local validation/build only. --site deploys the run site instead: an assets-only Worker on its custom domain with www redirected; with --dry-run it builds the site and prints the plan with no provider request.'],
 export: [['--target', '--output', '--origin', '--session-file'], 'Complete supported installation archive with integrity and exclusions.'],
 import: [['--target', '--input', '--journal', '--origin', '--session-file', '--yes', '--legacy-v1', '--acknowledge-unverified-metadata', '--output'], 'Confirmed atomic restore into an empty destination; --journal LATER_ARCHIVE also fences rows that installation erased since. Backup-only local v1 recovery requires --legacy-v1 --acknowledge-unverified-metadata and a new --output v2 archive; --journal requires normal v2 import.'],
 outbox: [['--port', '--host', '--owner-email', '--open'], 'Credential-free local outbox URL; optional ordinary sign-in request and explicit browser opening.'],
 doctor: [[], 'Read-only installed tool, configuration and state diagnostics.'],
 describe: [[], 'Read-only description of actual command capabilities.'],
 check: [['--profile'], 'Read-only structural command contract and operations validation.'],
};
export const verbs = Object.fromEntries(Object.entries(definitions).map(([name, [flags, effects]]) => [name, { flags: [...commonFlags, ...flags, ...(['build','deploy','dev','preview','export','import'].includes(name)?['--platform']:[]), ...(['install','setup','dev','preview','build','verify','deploy','export','import'].includes(name)?['--no-queue']:[])], effects }]));
export const aliases = Object.fromEntries([...Object.keys(verbs).filter(v => v !== 'install'), 'release', 'deps', 'rer'].map(name => [name, name === 'deps' ? 'install' : name === 'rer' ? null : name]));
export const releaseFlags = ['--repo', '--project', '--repository', '--output', '--ref', '--dry-run', '--tag', '--clean-history', '--onto', '--env-file', '--no-queue'];
export const requiredHooks = ['preview', 'dependencies', 'build', 'migrate', 'start', 'health', 'owner', 'signIn', 'verify', 'deploy', 'portability', 'state', 'settings', 'input'];
