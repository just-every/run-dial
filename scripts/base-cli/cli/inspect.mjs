import { dependencyDoctor } from './dependency-doctor.mjs';
import { inventory } from './export.mjs';
import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { delimiter, dirname, resolve } from 'node:path';
import { aliases, pins, requiredHooks, serverDefaults, verbs, releaseFlags } from './contract.mjs';
import { runningVersion } from './version.mjs';
import { contained, readPackage } from './project.mjs';
import { shared } from './shared.mjs';
import { missing, RerError } from './errors.mjs';
import { projectNodePin } from './node-runtime-discovery.mjs';
import { localSettingKeys, requiredLocalSettings } from './settings.mjs';
import { localAiDiagnostics } from './ai-local.mjs';
import { authCopyClauses } from './auth-copy.mjs';
import { cacheWarnings } from './cache-doctor.mjs';
import { deployedMain } from './deploy-config.mjs';
import { commandArgv, commandLine, declaredPackage, exactVersion, lockedPackage, packageName, vendoredPaths } from './package-mode.mjs';
import { vendoredCalls } from './package-calls.mjs';
import { doorProtocol } from './door.mjs';
import { savedOrigin } from './door-mode.mjs';

// cliVersion: the rer version of the code answering (absent for a vendored copy
// too old to record one). defaults: what a server start applies when the person
// sets nothing.
export async function describe(project) {
 const pkg = await readPackage(project.root), cliVersion = runningVersion(), versioned = cliVersion ? { cliVersion } : {};
 const defaults = { serverLimit: serverDefaults.serverLimit, idleSeconds: serverDefaults.idleSeconds };
 if (project.profile === 'independent') return {
  contractVersion: 1, ...versioned, profile: 'independent', defaults, pins: {}, aliases: {},
  verbs: Object.fromEntries(Object.entries(project.descriptor.commands).map(([verb, declaration]) => [verb, { flags: ['--help', '--cwd', '--non-interactive', '--json', ...(['install','setup','build','verify','dev','preview','deploy','export','import'].includes(verb)?['--no-queue']:[]), '--'], effects: declaration.effects }])),
 };
 const capabilities = project.adapter?.verbs ?? {};
 return { contractVersion: 1, ...versioned, profile: 'first-party', defaults, pins: { node: pkg.engines?.node, pnpm: pkg.packageManager?.replace(/^pnpm@/, '') },
  verbs: Object.fromEntries(Object.entries(capabilities).map(([verb, capability]) => [verb, { flags: (verbs[verb]?.flags ?? releaseFlags).filter(flag => capability.flags?.includes(flag)), effects: verbs[verb]?.effects ?? 'Existing Base release producer.' }])),
  aliases: Object.fromEntries(Object.entries(aliases).filter(([alias, verb]) => pkg.scripts?.[alias] === commandLine(verb, declaredPackage(pkg) !== undefined))),
  local: { state: project.adapter?.state, settings: project.adapter?.settings ?? [], installerState: '.seed/installer', outbox: '/__dev/outbox', ...await localState(project), origin: await savedOrigin(project), ...(project.adapter?.devIdentity ? { devIdentity: true, devKey: '.rer/local/dev-key.env' } : {}) },
  // This pin serves a checkout through the machine's front door (rer door).
  door: { protocol: doorProtocol },
 };
}

// prepared: local setup has completed (the private settings file holds the
// owner, the origin and every required generated or supplied secret).
// ownerSaved: that file already holds the owner email, which a later setup keeps.
async function localState(project) {
 const settings = project.adapter?.hooks?.secrets ?? {}, unprepared = { prepared: false, ownerSaved: false };
 let values;
 try {
  const text = await readFile(await contained(project.root, settings.file ?? '.dev.vars'), 'utf8');
  values = settings.format === 'json' ? JSON.parse(text) : (await shared('local/environment.mjs')).localVariables(text);
 } catch { return unprepared; }
 if (!values || typeof values !== 'object' || Array.isArray(values)) return unprepared;
 if (project.adapter?.setup && !project.setupManifest) {
  const { loadInstallerSeed } = await shared('setup-manifest.mjs');
  try { project.setupManifest = (await loadInstallerSeed(project.root, project.adapter)).manifest; } catch { return unprepared; }
 }
 return { prepared: requiredLocalSettings(project, values).length === 0, ownerSaved: Boolean(values[localSettingKeys(project).email]) };
}

export async function check(project, explicitProfile) {
 const clauses = [], add = (id, ok, message) => clauses.push({ id, ok: Boolean(ok), ...(!ok ? { message } : {}) });
 for (const command of project.commands) add('SC-10.inputs.' + command.name, command.available, `Restore the declared inputs for ${command.name}.`);
 for (const loop of project.descriptor.loops ?? []) add('SC-10.loop.' + loop.id, !loop.required || loop.enabled, `Enable the required ${loop.id} loop or correct its declaration.`);
 if (project.profile === 'first-party' || explicitProfile === 'first-party') {
  const adapter = project.adapter, pkg = await readPackage(project.root), marker = project.descriptor.seedContract;
  // Package mode (an @runeditrun/rer pin) and vendored mode differ only in
  // where rer comes from: the command targets and the source clauses below.
  const packaged = declaredPackage(pkg) !== undefined;
  add('SC-09.profile', marker?.version === 1 && marker?.profile === 'first-party', 'Restore OPERATIONS v2 seedContract version 1, profile first-party and the adapter pointer.');
  add('SC-01.adapter', adapter?.version === 1, 'Export commandAdapter version 1 from scripts/installer/local.mjs.');
  for (const hook of requiredHooks) add('SC-01.hook.' + hook, adapter?.[hook] ?? adapter?.hooks?.[hook], `Missing ${hook} hook/inventory; adopt the shared command adapter with a real ${hook} target.`);
  for (const [verb, definition] of Object.entries({ ...verbs, release: { flags: releaseFlags } })) {
   const declaration = project.descriptor.commands[verb];
   add('SC-01.verb.' + verb, declaration && adapter?.verbs?.[verb], `Missing ${verb}; declare it in OPERATIONS and expose its shared implementation.`);
   for (const flag of definition.flags) add('SC-01.flag.' + verb + '.' + flag.slice(2), adapter?.verbs?.[verb]?.flags?.includes(flag), `Missing ${verb} ${flag}; restore the shared implementation supporting this flag.`);
   const argv = commandArgv(verb, packaged);
   add('SC-02.target.' + verb, declaration?.argv?.join('\0') === argv.join('\0'), `Declare ${verb} argv as ${argv.join(' ')}.`);
  }
  for (const [alias, verb] of Object.entries(aliases)) add('SC-02.alias.' + alias, pkg.scripts?.[alias] === commandLine(verb, packaged), `Set package script ${alias} to ${commandLine(verb, packaged)}.`);
  add('SC-02.install-lifecycle', !pkg.scripts?.install, 'Remove the install lifecycle alias; use deps or frozen pnpm install.');
  let nodeFile; try { nodeFile = (await readFile(resolve(project.root, '.node-version'), 'utf8')).trim(); } catch {}
  add('SC-02.node-file', nodeFile === pins.node, `Set .node-version to ${pins.node}.`);
  add('SC-02.node-engine', pkg.engines?.node === pins.node, `Pin package.json engines.node to ${pins.node}.`);
  add('SC-02.pnpm', pkg.packageManager === `pnpm@${pins.pnpm}`, `Pin packageManager to pnpm@${pins.pnpm}.`);
  if (packaged) for (const [id, ok, message] of await packageClauses(project.root, pkg)) add(id, ok, message);
  // Vendored mode: the copy and its recorded inventory.
  else {
  for (const path of ['scripts/rer.mjs', 'scripts/base-cli/inventory.json', 'scripts/base-onboarding/adapter.mjs']) {
   let exists = false; try { await contained(project.root, path); exists = true; } catch {}
   add('SC-01.portable.' + path, exists, `Restore portable source ${path} through the documented export tool.`);
  }
  try {
   const record = JSON.parse(await readFile(resolve(project.root, 'scripts/base-cli/inventory.json'), 'utf8'));
   for(const name of ['production-runtime.mjs','production-options.mjs','production-plan.mjs','production-modules.mjs','project-vite.mjs','operator-install.mjs','operator-prerequisites.mjs','command-recovery.mjs','queue.mjs','queued-entry.mjs','commands.mjs','process-scope.mjs'])
    add('SC-12.onboarding.'+name,record.onboardingFiles?.[name],`Restore the required onboarding/queue source ${name}.`);
   for(const [path,source]of Object.entries(record.onboardingFiles??{})){
    let exact=false;try{const local=await contained(project.root,'scripts/base-onboarding/'+path);exact=createHash('sha256').update(await readFile(local)).digest('hex')===source.sha256;}catch{}
    add('SC-12.onboarding-inventory.'+path,exact,`Restore stale or missing shared execution source ${path}.`);
   }
   const actual=await inventory(resolve(project.root,'scripts/base-cli'));
   add('SC-09.inventory-complete',JSON.stringify(actual)===JSON.stringify(Object.keys(record.files).sort()),'Regenerate the complete portable source inventory.');
   for(const path of ['cli/settings.mjs','cli/bounded.mjs','cli/server-resources.mjs','cli/managed-server.mjs','cli/server-registry.mjs','cli/server-activity.mjs','cli/server-proxy.mjs','cli/preview-cache.mjs','modules/job-queue/cli.mjs','modules/job-queue/config.mjs','modules/job-queue/resources.mjs','modules/job-queue/storage.mjs','modules/job-queue/identity.mjs','modules/job-queue/processes.mjs','modules/job-queue/index.mjs','modules/job-queue/command.mjs','modules/job-queue/supervisor.mjs','modules/job-queue/membership.mjs','modules/job-queue/policy.mjs'])
    add(path.startsWith('cli/')?'SC-11.source.'+path:'SC-12.source.'+path,record.files[path],`Restore required managed lifecycle/queue source ${path}.`);
   for (const [path, source] of Object.entries(record.files)) {
    let exact = false;
    try { const local = await contained(project.root, 'scripts/base-cli/' + path); exact = createHash('sha256').update(await readFile(local)).digest('hex') === source.sha256; } catch {}
    add('SC-01.inventory.' + path, exact, `Restore stale or missing portable CLI source ${path} with the source export tool.`);
   }
  } catch { add('SC-01.inventory', false, 'Restore the deterministic portable CLI source inventory.'); }
  }
  add('SC-08.portability', typeof adapter?.portability?.export === 'function' && typeof adapter?.portability?.import === 'function', 'Adopt the reviewed mainline complete local portability API; archive support remains unavailable until then.');
  if (adapter?.devIdentity) for (const [id, ok, message] of await devIdentityClauses(project.root, adapter)) add(id, ok, message);
  for (const [id, ok, message] of await authCopyClauses(project.root)) add(id, ok, message);
 }
 for(const issue of await localAiDiagnostics(project,process.env))add('AI.'+issue.feature,false,issue.code+': '+issue.message);
 return { clauses, ok: clauses.every(clause => clause.ok) };
}

// Package mode: the exact pin, its lockfile entry, no vendored copy and no
// command still calling one.
async function packageClauses(root, pkg) {
 const declared = declaredPackage(pkg), locked = await lockedPackage(root), clauses = [];
 clauses.push(['SC-13.package.pin', pkg.devDependencies?.[packageName] === declared && exactVersion.test(declared), `Pin ${packageName} in devDependencies to an exact version (for example "0.2.0"), not ${JSON.stringify(declared)} or a runtime dependency.`]);
 clauses.push(['SC-13.package.lockfile', locked?.locked && locked.specifier === declared && locked.version === declared, `Run pnpm install so pnpm-lock.yaml locks ${packageName} ${declared}${locked?.version ? ` (it locks ${locked.version})` : ''}.`]);
 for (const path of vendoredPaths) {
  let present = true; try { await lstat(resolve(root, path)); } catch { present = false; }
  clauses.push(['SC-13.package.vendored.' + path, !present, `Remove ${path}: a checkout that pins ${packageName} runs the package, not a vendored copy (node scripts/export-cli.mjs --to-package converts one).`]);
 }
 // Delivery operations, the scripts they run and CI workflows call the package too.
 const calls = await vendoredCalls(root);
 clauses.push(['SC-13.package.calls', !calls.length, `Run pnpm exec rer VERB instead of the removed vendored copy (pnpm install --frozen-lockfile first where nothing has installed yet) in ${calls.length} place${calls.length === 1 ? '' : 's'}:\n${calls.slice(0, 20).join('\n')}${calls.length > 20 ? `\n...and ${calls.length - 20} more` : ''}`]);
 return clauses;
}

// Without the pinned pnpm on PATH, rer provides it for this command only
// (cli/pnpm-runtime.mjs); it never changes global tools.
export async function tools(root, store, signal) {
 const node = await projectNodePin(root);
 if (node && process.versions.node !== node) throw missing(`Node ${node} is required. Run it with rer, with automatic project runtime selection enabled.`);
 const found = await probePnpm(root, store, signal).catch(error => { if (signal?.aborted) throw error; return null; });
 if (found === pins.pnpm) return;
 const { cachedPnpm, downloadPnpm } = await import('./pnpm-runtime.mjs');
 let directory = await cachedPnpm(pins.pnpm);
 if (!directory) {
  store.report?.(`Fetching pnpm ${pins.pnpm} for this project (PATH has ${found ? `pnpm ${found}` : 'no pnpm'}); rer keeps it in its own cache.`);
  try { directory = await downloadPnpm(pins.pnpm, signal); }
  catch (error) { if (signal?.aborted || error instanceof RerError) throw error; throw missing(`pnpm ${pins.pnpm} is required and could not be fetched (${error.message}). Check the connection, or install pnpm ${pins.pnpm} yourself.`); }
 }
 usePnpm(directory);
 if (await probePnpm(root, store, signal) !== pins.pnpm) throw missing(`pnpm ${pins.pnpm} is required. The pnpm rer provides did not report it; install pnpm ${pins.pnpm} yourself.`);
}
const usePnpm = directory => { process.env.PATH = [dirname(process.execPath), directory, process.env.PATH].filter(Boolean).join(delimiter); };

export async function doctor(project, store, signal) {
 const { inspectOperations } = await import('../operations/operations.mjs');
 const diagnostic = await inspectOperations(project.root);
 const { localVariables } = await shared('local/environment.mjs');
 let values = {}, pnpm, stateValid = true;
 if (project.profile === 'first-party') {
  const { selectLocalState } = await shared('local/state.mjs');
  try { await selectLocalState(project.root, project.adapter.state); } catch { stateValid = false; }
 }
 if (project.profile === 'first-party') {
  try {
   const settings = project.adapter?.hooks?.secrets ?? {};
   const file = await contained(project.root, settings.file ?? '.dev.vars');
   const text = await readFile(file, 'utf8');
   const parsed = settings.format === 'json' ? JSON.parse(text) : localVariables(text);
   if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) values = parsed;
  } catch {}
  try { pnpm = await probePnpm(project.root, store, signal); } catch (error) { if (signal?.aborted) throw error; }
  // A pnpm rer already provides counts; doctor never fetches one.
  if (pnpm !== pins.pnpm) {
   const directory = await (await import('./pnpm-runtime.mjs')).cachedPnpm(pins.pnpm).catch(() => undefined);
   if (directory) { usePnpm(directory); try { pnpm = await probePnpm(project.root, store, signal); } catch (error) { if (signal?.aborted) throw error; } }
  }
 }
 const aiIssues = await localAiDiagnostics(project,process.env);
 const dependencies=project.profile==='first-party'?await dependencyDoctor(project.root):[];
 const expectedNode = await projectNodePin(project.root);
 const keys = localSettingKeys(project);
 const inputs = project.profile === 'first-party' ? requiredLocalSettings(project, values) : [];
 const warnings = project.profile === 'first-party' ? await cacheWarnings(project.root) : [];
 return { dependencies, warnings, ok: !aiIssues.length && dependencies.every(d=>d.ok) && diagnostic.ok && stateValid && !inputs.length && (project.profile !== 'first-party' || (process.versions.node === expectedNode && pnpm === pins.pnpm)),
  node: { actual: process.versions.node, expected: expectedNode },
  pnpm: project.profile === 'first-party' ? { actual: pnpm, expected: pins.pnpm } : undefined,
  ai: { issues: aiIssues },
  missingInputs: [...new Set([...diagnostic.missingEnvironment, ...inputs])],
  sources: project.descriptor.environmentSources ?? {}, state: { path: project.adapter?.state, safe: stateValid }, scope: 'local-inputs-only' };
}

// Diagnostics and execution use the same identity-checked process custody.
// Exit starts cleanup even if a descendant still holds the output pipes.
async function probePnpm(root, store, signal) {
 const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)].filter(Boolean));
 const child = store.spawn('Checking pinned pnpm', 'pnpm', ['--version'], { cwd: root, signal: probeSignal });
 let version = '';
 child.stdout.on('data', chunk => { version = (version + chunk).slice(-1024); });
 const code = await new Promise(resolve => { child.once('error', () => resolve(null)); child.once('exit', code => resolve(code)); });
 await store.stop(child);
 if (probeSignal.aborted || code !== 0) throw missing('The pinned pnpm version probe failed. Select the documented tool.');
 return version.trim();
}

// SC-05: a seed declaring devIdentity loads the dev layer only from a local-only
// entry that its dev configuration names, never from the deployed main, lets
// rer build scan its output, and keeps one end-to-end email-link test.
async function devIdentityClauses(root, adapter) {
 const declaration = adapter.devIdentity;
 const text = async path => { try { return await readFile(await contained(root, path), 'utf8'); } catch { return null; } };
 const entry = typeof declaration.entry === 'string' ? declaration.entry.replace(/^\.\//, '') : '';
 const main = await deployedMain(root, adapter);
 const production = main ? await text(main) : null;
 const configs = (await Promise.all(['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs', 'wrangler.local.jsonc', 'wrangler.local.json', 'wrangler.local.toml'].map(text))).filter(Boolean);
 const test = typeof declaration.emailLinkTest === 'string' ? await text(declaration.emailLinkTest) : null;
 return [
  ['SC-05.dev-identity.entry', entry && await text(entry) !== null && entry !== main && configs.some(config => config.includes(entry)), 'Declare devIdentity.entry as an existing local-only Worker entry that the local Vite or wrangler configuration loads and that is not the deployed main.'],
  ['SC-05.dev-identity.exclusion', production !== null && !/operator-auth\/dev\//.test(production) && !production.includes(entry.replace(/\.[a-z]+$/, '')) && Array.isArray(declaration.output) && declaration.output.length > 0, 'Keep the deployed main free of the dev layer and its local entry, and declare devIdentity.output so rer build refuses output containing the dev layer.'],
  ['SC-05.dev-identity.email-link-test', test !== null && /outbox/i.test(test), 'Keep one end-to-end email-link test through the outbox and declare it as devIdentity.emailLinkTest.'],
 ];
}
