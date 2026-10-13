import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dependencyInputs } from './dependency-input.mjs';
import { linkDependencies } from './dependencies.mjs';
import { savedSetupAnswers } from './setup-answers.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shared } from './shared.mjs';
import { tools, doctor } from './inspect.mjs';
import { availablePort, selectedOrigin, setupInput, stateSafety, refuseLegacyProcess } from './local.mjs';
import { missing, refuse, RerError, lifecycleError } from './errors.mjs';
import { executeDeclared } from './independent.mjs';
import { transfer } from './transfers.mjs';
import { runtimeFrontDoor } from './runtime-front-door.mjs';
import { localSettingKeys, requiredLocalSettings } from './settings.mjs';
import { rememberSetupAnswers } from './setup-answers.mjs';
import { ensureDevKey, readDevKey, refuseDevLayerOutput, openUrl, DEV_KEY_HEADER } from './dev-identity.mjs';

export async function runCommand(project, options, out) {
 if(project.profile==='first-party'&&['dev','preview'].includes(options.verb))return (await import('./managed-server.mjs')).managedServer(project,options,out);
 const cancellation = new AbortController(), signal = cancellation.signal;
 let termination, operation, store, temporary, proxy;
 const handlers = new Map(['SIGINT', 'SIGTERM'].map(name => [name, () => { if (!termination) { termination = name; cancellation.abort(name); } }]));
 for (const [name, handler] of handlers) process.on(name, handler);
 try {
  let selected, input;
  if (project.profile === 'first-party') {
   if (project.adapter?.setup) {
    const { loadInstallerSeed } = await shared('setup-manifest.mjs');
    try { project.setupSeed = await loadInstallerSeed(project.root, project.adapter); }
    catch { throw new RerError('invalid_setup_manifest', 'The declared setup manifest or presentation is invalid. Restore its sources before retrying.', 2); }
    project.setupManifest = project.setupSeed.manifest;
   }
  }
  if (project.profile === 'first-party' && options.verb !== 'doctor') {
   if (!project.adapter?.run) throw refuse('The first-party command adapter is unavailable. Restore the shared lifecycle adapter.');
   if (options.forwarded.length) throw refuse('First-party commands do not accept arbitrary forwarded arguments. Run rer VERB --help.');
   await stateSafety(project);
   if(options.verb==='setup')await refuseLegacyProcess(project);
   if (['setup', 'outbox'].includes(options.verb)) {
    selected = await selectedOrigin(project, options, { setup: options.verb === 'setup' });
    if (options.verb === 'setup') {input = await setupInput(project, options, selected.vars, signal);await dependencyInputs({project,input,origin:selected.url});}
    else if (requiredLocalSettings(project, selected.vars).length) throw missing('Private owner settings are missing. Run rer setup --owner-email EMAIL first.');
    if (options.verb !== 'outbox') await availablePort(selected.host, selected.port);
   }
   const { localOperation } = await shared('local/operation.mjs');
   if (options.verb !== 'outbox') try { operation = await localOperation(project.root, process.env.RER_LOCAL_OPERATION); } catch (error) { throw refuse(error.message); }
   const { recoverInterrupted } = await shared('local/recovery.mjs');
   if (operation) await recoverInterrupted(project.root, operation);
  }
  const { createCommands } = await shared('commands.mjs');
  const { privateDirectory } = await shared('private-files.mjs');
  // Nested public commands stream into their caller's capture and keep their
  // own log separate, including the browser install/setup/preview journey.
  const capture = ['.seed', 'installer', ...(process.env.RER_LOCAL_OPERATION || process.env.RER_ONBOARDING_PROCESS_OWNER ? [`commands-${process.pid}`] : [])];
  const directory = project.profile === 'first-party' && !['outbox', 'doctor'].includes(options.verb) ? await privateDirectory(project.root, capture) : (temporary = await mkdtemp(join(tmpdir(), 'rer-command-')));
  const state = { logs: [] };
  store = await createCommands(directory, state, { terminal: text => out.progress(text), onWaiting: options.json ? details => out.event('waiting', details) : undefined, queue: ['install','setup','build','verify','deploy','export','import'].includes(options.verb)?{verb:options.verb,originalCI:process.env.CI==='true'}:undefined });
  store.state = state;
  store.setupManifest = project.setupManifest;
  store.step = async label => { state.step = store.redact(label); store.report(label); };
  store.phase = async phase => { state.phase = phase; };
  store.setCommandSignal(signal);
  if (options.verb === 'doctor') return await doctor(project, store, signal);
  if (project.profile === 'independent') return await executeDeclared(project, options, store, signal);
  await tools(project.root, store, signal);
  const adapter = project.adapter;
  if (options.verb === 'install') {
   await store.run('Installing frozen dependencies', 'pnpm', ['install', '--frozen-lockfile'], { cwd: project.root, signal, env: { ...process.env, CI: 'true' } }); return {};
  }
  if (options.verb === 'verify') {
   const target = adapter.verify;
   if (!Array.isArray(target)) throw refuse('A complete internal verification target is missing.');
   await store.run('Verifying application', target[0], target[1], { cwd: project.root, signal, env: { ...process.env, RER_LOCAL_OPERATION: operation.token } }); return {};
  }
  if (['export', 'import'].includes(options.verb)) return await transfer(project, options, signal, { store, operationToken: operation.token });
  if (options.verb === 'deploy') {
   if (typeof adapter.deploy !== 'function') throw refuse('Owner-account deploy declaration is missing.');
   const deployed = await adapter.deploy({ root: project.root, options, store, signal, operationToken: operation.token, localOnlyKeys: adapter.localOnlyKeys ?? [], checkBuild: () => refuseDevLayerOutput(project.root, adapter.devIdentity) });
   if(deployed.deployed && !options.dryRun) await linkDependencies({project,input:await savedSetupAnswers(project,project.setupSeed.model),origin:deployed.origin,store,signal,appSetupToken:process.env[project.setupManifest?.steps.find(step=>step.type==='owner-claim')?.tokenField??'SETUP_TOKEN']});
   return deployed;
  }
  // Setup writes the checkout's dev key; its temporary app and the CLI's own
  // outbox reads present it. Captured logs redact it.
  const devKey = adapter.devIdentity ? options.verb === 'setup' ? await ensureDevKey(project.root) : await readDevKey(project.root) : null;
  if (devKey) store.addSecrets?.([devKey]);
  let app;
  if (options.verb === 'setup') proxy = await runtimeFrontDoor(selected);
  const emailKey = localSettingKeys(project).email;
  await adapter.run(project.root, input ?? { [emailKey]: options.ownerEmail ?? selected?.vars[emailKey] }, store,
   child => { app = child; }, signal,
   { verb: options.verb, selectedOrigin: selected?.url, runtimePort: proxy?.runtimePort, operationToken: operation?.token, dev: adapter.dev, privateSettings: [...adapter.settings, '.rer/local/models.json', ...(project.privateInputs??[])], signInEmail: options.verb === 'outbox' ? options.ownerEmail : undefined, requestSignIn: Boolean(options.ownerEmail), devKey: devKey ?? undefined });
  if (['setup', 'build'].includes(options.verb)) await refuseDevLayerOutput(project.root, adapter.devIdentity);
  const url = selected?.url, signInUrl = url ? url + '/__dev/outbox' : undefined;
  if (options.verb === 'setup') {
   await linkDependencies({project,input,origin:url,store,signal});
   if(project.setupManifest?.dependencies?.length) {
    const { localVariables }=await shared('local/environment.mjs');
    const values=localVariables(await readFile(new URL(project.adapter.hooks?.secrets?.file??'.dev.vars','file://'+project.root+'/'),'utf8'));
    const proof=createHmac('sha256',values.SESSION_SECRET).update('local-cli\0sign-in').digest('hex');
    store.addSecrets?.([proof]);
    const completed=await fetch(url+'/auth/setup-complete',{method:'POST',headers:{Origin:url,'Content-Type':'application/json','x-rer-local-cli':proof},body:'{}',signal});
    if(!completed.ok)throw missing('The dependency setup has not completed an owner claim.');
    await completed.body?.cancel();
   }
   await store.stop(app);
   await rememberSetupAnswers(project, input);
   if (options.json) out.event('setup-ready', { url, signInUrl, setupUrl: url+'/setup' });
   else if (devKey) { out.human(`RER_SETUP_READY ${url}`); out.human(`Next: pnpm run dev opens ${url} signed in as the owner; first-run setup finishes at ${url}/setup.`); }
   else { out.human(`RER_SETUP_READY ${url}`); signInInstructions(out, signInUrl); out.human(`Finish first-run setup at ${url}/setup after sign-in.`); out.human('Next: pnpm run dev'); }
  } else if (options.verb === 'outbox') {
   const response = await fetch(signInUrl, { headers: devKey ? { [DEV_KEY_HEADER]: devKey } : {}, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
   if (!response.ok) throw new RerError('outbox_unavailable', 'The local application outbox is unavailable. Start rer dev first.', 1);
   await response.body?.cancel();
   const open = devKey ? openUrl(url, devKey, { path: '/__dev/key', next: '/__dev/outbox' }) : signInUrl;
   if (options.json) out.event('outbox', { signInUrl, ...(devKey ? { openUrl: open } : {}) }); else { signInInstructions(out, signInUrl); if (devKey) out.human(`RER_OPEN ${open}`); }
   if (options.open && !options.json && !options.nonInteractive) await store.run('Opening local outbox', process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [open], { cwd: project.root, signal });
  } else if (options.verb !== 'build') throw refuse('The requested first-party capability is unavailable.');
  return {};
 } catch (error) {
  if (error instanceof RerError) throw error;
  throw await lifecycleError(error, store);
 } finally {
  await store?.closeCommands(); await proxy?.close(); await operation?.release();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  for (const [name, handler] of handlers) process.removeListener(name, handler);
  if (termination) throw new RerError('cancelled', `Stopped by ${termination} after owned children were stopped.`, termination === 'SIGINT' ? 130 : 143);
 }
}

function signInInstructions(out, url) {
 out.human(`RER_SIGN_IN ${url}`);
 out.human('Open the outbox, choose the newest sign-in message and follow its link. No email was sent.');
}
