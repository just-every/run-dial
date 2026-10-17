import { readinessWindow } from './readiness-window.mjs';
import { uploadedWorker } from './uploaded-worker.mjs';
import { ingressBindings } from './container-config.mjs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assert, hash, identifier, resourceName, uuid, validatePlan } from './validation.mjs';
import { definiteProviderRefusal } from './provider.mjs';
import { regularBytes } from './artifact.mjs';
import { resourceKinds, findResource, checkCronOwnership } from './resources.mjs';
import { secretBindings, activeWorker, deployedFingerprint } from './worker.mjs';
import { validateMigrations } from './migrations.mjs';
import { deploy } from './deploy.mjs';
import { verifyHealth } from './health.mjs';
import { validSecretNames, secretNames, pendingSecretNames } from './owner-secret-names.mjs';
import { copyMessage, undeployedCopy } from './owner-secret-copy.mjs';
import { publicOrigin } from './public-origin.mjs';

/* Owner-account mode: the owner's own Cloudflare account, token and account id.
 * Names are derived from the project id and the owner's environment. A local
 * state file records what this kit created; a same-named resource it did not
 * create is refused, never adopted. */

const segment = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const STATE_KIND = 'rer-deploy-owner-state';
export const KINDS = ['d1','r2','kv','queues'];
const DECLARATION_KEYS = ['version','project','compatibilityDate','compatibilityFlags','d1','r2','kv','queues','durableObjects','secrets','crons','vars','originVar','publicOriginSetting','publicSettings','services','workersDev','platforms','container','deployGuide'];
const ENTRY_KEYS = {d1:['binding'],r2:['binding','locationHint'],kv:['binding'],queues:['binding','consumer','deadLetterQueue'],durableObjects:['binding','className','storage'],secrets:['binding','environment','verifyStandIn','optional'],services:['binding','project','entrypoint','allowedHosts','grant']};

export function refuse(code, kind, name) { const error = new Error(code); error.resource = `${kind}:${name}`; return error; }

export function ownerWorkerName(project, environment) {
  assert(typeof project === 'string' && /^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9-]+$/.test(project) && segment.test(project.split('/').at(-1)), 'invalid-owner-project');
  assert(typeof environment === 'string' && environment.length <= 32 && segment.test(environment), 'invalid-owner-environment');
  const worker = `${project.split('/').at(-1)}-${environment}`;
  assert(resourceName(worker), 'owner-name-too-long');
  return worker;
}
/** `JOBS_DEAD` on Worker `penny-production` is named `penny-production-jobs-dead`. */
export function ownerResourceName(worker, binding) {
  assert(identifier(binding), 'duplicate-or-invalid-binding');
  const slug = binding.toLowerCase().replaceAll('_','-');
  assert(segment.test(slug), 'invalid-owner-binding');
  assert(resourceName(`${worker}-${slug}`), 'owner-name-too-long');
  return `${worker}-${slug}`;
}
/* A 401 or 403 on a known path names the token permission that failed, never the request. */
const SCOPES = [[/^\/d1\//,'d1'],[/^\/r2\//,'r2'],[/^\/storage\/kv\//,'kv'],[/^\/queues(?:[/?]|$)/,'queues'],[/^\/workers\//,'workers']];
export function withScopeHints(api) {
  if (api.scopeHints) return api;
  const hint = (path, error) => {
    const scope = (error.status === 401 || error.status === 403) && SCOPES.find(([pattern]) => pattern.test(path));
    if (scope) error.message = `token-scope-missing-${scope[1]}`;
    throw error;
  };
  const guard = method => async (path, ...rest) => { try { return await api[method](path, ...rest); } catch (error) { return hint(path, error); } };
  return {...api, scopeHints:true, request:guard('request'), envelope:guard('envelope'), list:guard('list')};
}
/** Right after a create, an account listing can disagree with its own page counts
 * (D1's total_count lagged its rows by about 7 seconds, measured 13 October 2026) or
 * not show the new resource yet. Owner mode discards a partial snapshot and lists
 * again from the start for up to `windowMs`; a partial listing is never accepted. */
export const LIST_WINDOW_MS = 120000;
const settleable = error => ['provider-partial-list','provider-pagination-changed'].includes(error.message);
export function withSettledLists(api, {windowMs = LIST_WINDOW_MS, clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  if (api.settledLists) return api;
  const list = async (...args) => {
    const start = clock();
    for (let delay = 500; ; delay = Math.min(delay * 2, 4000)) {
      try { return await api.list(...args); }
      catch (error) {
        if (!settleable(error) || clock() - start + delay > windowMs) throw error;
        await sleep(delay);
      }
    }
  };
  return {...api, settledLists:true, unsettled:api, list};
}
/** Waits until the account's listing shows a resource this run just created, so no later
 * read mistakes it for a missing or replaced one. One that never appears is named. */
async function listedAfterCreate(api, kind, item, {windowMs = LIST_WINDOW_MS, clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const start = clock();
  for (let delay = 500; ; delay = Math.min(delay * 2, 4000)) {
    try { if (findResource(await resourceKinds[kind].list(api.unsettled ?? api),kind,item.name)) return; }
    catch (error) { if (!settleable(error)) throw error; }
    if (clock() - start + delay > windowMs) throw refuse('resource-not-listed',kind,item.name);
    await sleep(delay);
  }
}
/** Reads the account's workers.dev subdomain; no other provider request. */
export async function ownerTarget(provider, {project, environment}) {
  const api = withScopeHints(provider);
  const worker = ownerWorkerName(project, environment);
  let result;
  try { result = await api.request('/workers/subdomain'); }
  catch (error) { if (error.status === 404) throw new Error('workers-subdomain-missing'); throw error; }
  assert(typeof result?.subdomain === 'string' && result.subdomain, 'workers-subdomain-missing');
  assert(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(result.subdomain),'invalid-account-subdomain');
  return {accountId:api.accountId,project,environment,worker,origin:`https://${worker}.${result.subdomain}.workers.dev`};
}

function entries(declaration, key) {
  const list = declaration[key] ?? [];
  assert(Array.isArray(list) && list.every(item => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(k => ENTRY_KEYS[key].includes(k))), 'invalid-owner-declaration');
  return list;
}
/* RER_DEV_KEY opens local dev identity and RER_DEMO turns on demo mode (mocked
 * third-party effects, throwaway data); they and every key a seed adapter declares local-only
 * never become a deployed binding, secret or secret source. */
export const LOCAL_ONLY_KEYS = Object.freeze(['RER_DEV_KEY', 'RER_DEMO', 'RER_MODELS_KEY', 'RER_MODELS_SERVICE', '.rer/local/models.json']);
export function localOnlyBinding(declaration, localOnlyKeys = []) {
  const refused = new Set([...LOCAL_ONLY_KEYS, ...localOnlyKeys]);
  const names = [...Object.keys(declaration?.vars ?? {}), declaration?.originVar, declaration?.publicOriginSetting, ...(Array.isArray(declaration?.secrets) ? declaration.secrets.flatMap(item => [item?.binding, item?.environment]) : [])];
  return names.find(name => refused.has(name)) ?? null;
}
/** A seed declares bindings, never names. Migrations come from the packaged artifact. */
export function ownerPlan(target, declaration, artifact, { localOnlyKeys = [], env = {} } = {}) {
  assert(declaration?.version === 1 && typeof declaration === 'object' && Object.keys(declaration).every(key => DECLARATION_KEYS.includes(key)), 'invalid-owner-declaration');
  assert(declaration.publicSettings === undefined || Array.isArray(declaration.publicSettings) && new Set(declaration.publicSettings).size === declaration.publicSettings.length && declaration.publicSettings.every(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name)), 'invalid-public-settings');
  if (declaration.platforms !== undefined) assert(Array.isArray(declaration.platforms) && declaration.platforms.length > 0 && new Set(declaration.platforms).size === declaration.platforms.length && declaration.platforms.every(item => ['workers','container'].includes(item)), 'invalid-platforms');
  if (declaration.container !== undefined) {
    const config=declaration.container;
    assert(config&&typeof config==='object'&&!Array.isArray(config)&&Object.keys(config).every(key=>['engine','cacheContract','runner','hostVariables','ingress'].includes(key))&&['node','workerd'].includes(config.engine),'invalid-container');
    if(config.ingress!==undefined)ingressBindings(config.ingress);
    assert(config.hostVariables===undefined||Array.isArray(config.hostVariables)&&config.hostVariables.every(name=>/^[A-Z][A-Z0-9_]*$/.test(name)),'invalid-container-host-variables');
    assert(config.cacheContract===undefined||config.cacheContract==='lamp-retained-v1','invalid-container-cache');
    if(config.runner!==undefined){const runner=config.runner,relative=path=>typeof path==='string'&&!path.startsWith('/')&&path.split('/').every(part=>part&&!['.','..'].includes(part));assert(runner&&Object.keys(runner).every(key=>['entry','files'].includes(key))&&relative(runner.entry)&&Array.isArray(runner.files)&&runner.files.length>0&&runner.files.every(relative),'invalid-container-runner');}
  }
  const local = localOnlyBinding(declaration, localOnlyKeys);
  if (local) throw refuse('local-only-binding', 'binding', local);
  assert(declaration.project === undefined || declaration.project === target.project, 'owner-project-mismatch');
  const name = binding => ownerResourceName(target.worker, binding);
  const d1 = entries(declaration,'d1');
  assert(artifact.migrations.every(migration => d1.some(item => item.binding === migration.binding)), 'undeclared-migration-binding');
  const queues = entries(declaration,'queues');
  for (const item of queues) assert(item.deadLetterQueue === undefined || queues.some(other => other.binding === item.deadLetterQueue), 'invalid-dead-letter-queue');
  const vars = {...(declaration.vars ?? {})};
  const origin = publicOrigin(declaration, env);
  if (declaration.originVar !== undefined) {
    assert(identifier(declaration.originVar) && !Object.hasOwn(vars,declaration.originVar), 'invalid-owner-origin-variable');
    vars[declaration.originVar] = origin ?? target.origin;
  }
  const kv = entries(declaration,'kv').map(({binding}) => ({binding,name:name(binding)}));
  // A service binding names another project; its Worker name derives from the same environment.
  const services = entries(declaration,'services').map(({binding,project,entrypoint,allowedHosts,grant}) => ({binding,service:ownerWorkerName(project,target.environment),
    ...(grant === undefined ? {} : {grant}),...(entrypoint === undefined ? {} : {entrypoint}),...(allowedHosts === undefined ? {} : {props:{allowedHosts}})}));
  assert(declaration.workersDev === undefined || declaration.workersDev === false, 'invalid-owner-declaration');
  return validatePlan({version:1,worker:target.worker,compatibilityDate:declaration.compatibilityDate,compatibilityFlags:declaration.compatibilityFlags ?? [],
    d1:d1.map(({binding}) => ({binding,name:name(binding),migrations:artifact.migrations.filter(x => x.binding === binding).map(({binding:_,...rest}) => rest)})),
    r2:entries(declaration,'r2').map(item => ({...item,name:name(item.binding)})),
    ...(kv.length ? {kv} : {}),
    queues:queues.map(item => ({...item,name:name(item.binding),...(item.deadLetterQueue === undefined ? {} : {deadLetterQueue:name(item.deadLetterQueue)})})),
    durableObjects:entries(declaration,'durableObjects').map(item => ({...item})),
    // verifyStandIn is only `rer verify`'s hosted-check value: never planned, sent or stored.
    // An optional secret (`"optional": true`, an integration's credential) may stay unset: it is bound only once supplied.
    secrets:entries(declaration,'secrets').map(({verifyStandIn,...item}) => { assert(verifyStandIn === undefined || typeof verifyStandIn === 'string' && verifyStandIn.length > 0 && verifyStandIn.length <= 1024, 'invalid-verify-stand-in'); return item; }),
    crons:[...(declaration.crons ?? [])],vars,
    // Only declarations using these add the keys, so earlier plans and fingerprints are unchanged.
    ...(services.length ? {services} : {}),...(declaration.workersDev === false ? {workersDev:false} : {})});
}
function assertOwnerNames(target, plan) {
  assert(plan.worker === target.worker, 'owner-plan-name-mismatch');
  for (const kind of KINDS) for (const item of resourceKinds[kind].items(plan)) assert(item.name === ownerResourceName(target.worker,item.binding), 'owner-plan-name-mismatch');
}

function emptyState(target) {
  return {version:1,kind:STATE_KIND,accountId:target.accountId,project:target.project,environment:target.environment,worker:target.worker,
    owned:{worker:null,d1:{},r2:{},kv:{},queues:{}},receipt:null};
}
export async function readOwnerState(path, target) {
  let bytes;
  try { bytes = await regularBytes(path, 4 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return emptyState(target); throw error; }
  let state; try { state = JSON.parse(bytes); } catch { throw new Error('invalid-owner-state'); }
  assert(state?.version === 1 && state.kind === STATE_KIND && state.owned && typeof state.owned === 'object'
    && (state.owned.worker === null || ['pending','created'].includes(state.owned.worker?.status))
    && KINDS.every(kind => state.owned[kind] && typeof state.owned[kind] === 'object' && Object.values(state.owned[kind]).every(entry => ['pending','created'].includes(entry?.status))), 'invalid-owner-state');
  assert(state.pendingUpload === undefined || typeof state.pendingUpload?.fingerprint === 'string', 'invalid-owner-state');
  // Declared secrets rer removed on purpose (the spent setup token): later plans omit them.
  // A change recorded by an older rer names one `binding`.
  if (typeof state.pendingSecret?.binding === 'string' && state.pendingSecret.bindings === undefined) { const {binding, ...rest} = state.pendingSecret; state.pendingSecret = {...rest, bindings:[binding]}; }
  const pending = state.pendingSecret;
  assert(pending === undefined || Array.isArray(pending?.bindings) && pending.bindings.length > 0 && validSecretNames(pending.bindings) && typeof pending.present === 'boolean'
    && (pending.versionId === undefined || uuid(pending.versionId))
    && (pending.repeatVersionId === undefined || uuid(pending.repeatVersionId))
    && (pending.copy === undefined || /^[0-9a-f]{32}$/.test(pending.copy))
    && (pending.names === undefined || validSecretNames(pending.names) && !pending.names.some(name => pending.bindings.includes(name))), 'invalid-owner-state');
  assert(state.ownerClaim === undefined || ['claimed','kept'].includes(state.ownerClaim?.outcome), 'invalid-owner-state');
  assert(state.retiredSecrets === undefined || Array.isArray(state.retiredSecrets) && state.retiredSecrets.every(identifier), 'invalid-owner-state');
  assert(state.accountId === target.accountId && state.project === target.project && state.environment === target.environment && state.worker === target.worker, 'owner-state-target-mismatch');
  return state;
}
export async function writeOwnerState(path, state) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,path);
}
export const resourceId = (kind, row) => ({d1:row.uuid,r2:row.creation_date,kv:row.id,queues:row.queue_id})[kind];

export function checkResourceIdentity(kind, name, row, entry) {
  if (row) {
    if (!entry) throw refuse('resource-name-collision',kind,name);
    if (entry.status !== 'created') throw refuse('uncertain-resource-create',kind,name);
    // A state file from before bucket identities were recorded has no id to compare.
    if ((kind !== 'r2' || entry.id !== undefined) && entry.id !== resourceId(kind,row)) throw refuse('owned-resource-replaced',kind,name);
  } else if (entry?.status === 'created') throw refuse('owned-resource-missing',kind,name);
}

/** Read-only: every declared name is either created by this kit or absent. */
async function ownedResourcesToCreate(api, plan, state) {
  const create = [];
  for (const kind of KINDS) {
    const items = resourceKinds[kind].items(plan);
    if (!items.length) continue;
    const rows = await resourceKinds[kind].list(api);
    for (const item of items) {
      const row = findResource(rows,kind,item.name);
      const entry = state.owned[kind][item.name];
      checkResourceIdentity(kind,item.name,row,entry);
      if (!row) create.push({kind,item});
    }
  }
  return create;
}
/** Re-read every saved resource, including resources omitted from a later plan. */
async function checkSavedResourceIdentities(api, state) {
  for (const kind of KINDS) {
    const entries = Object.entries(state.owned[kind]);
    if (!entries.length) continue;
    const rows = await resourceKinds[kind].list(api);
    for (const [name,entry] of entries) checkResourceIdentity(kind,name,findResource(rows,kind,name),entry);
  }
}
/** Read-only: a bound service Worker must already exist in the account; deploy it first. */
async function checkServiceWorkers(api, plan) {
  for (const {service} of plan.services ?? []) if (await workerSettings(api, service) === null) throw refuse('service-worker-missing','service',service);
}
export async function workerSettings(api, worker) {
  try { return await api.request(`/workers/scripts/${worker}/settings`); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
/** The fingerprint an upload is about to write, read from its own metadata part. */
async function uploadFingerprint(body) {
  const metadata = JSON.parse(await body.get('metadata').text());
  const fingerprint = deployedFingerprint(metadata);
  assert(typeof fingerprint === 'string' && fingerprint, 'invalid-upload-metadata');
  return fingerprint;
}
/** Record a secret change's outcome on the receipt: the Worker version it made, and whether
 * its secrets are now retired (a removed declared secret stays out of later plans). */
export function recordSecretChange(state, current, {bindings, present}) {
  state.receipt.provider = {versionId:current.versionId, deploymentId:current.deploymentId, etag:current.etag};
  const retired = new Set(state.retiredSecrets ?? []);
  for (const binding of bindings) if (present) retired.delete(binding); else retired.add(binding);
  if (retired.size) state.retiredSecrets = [...retired].sort(); else delete state.retiredSecrets;
  delete state.pendingSecret;
}
/** A secret change rer recorded as pending but never confirmed (a lost response, or a run that
 * ended before the change settled). It is that change only when the Worker's versions list shows
 * exactly one version after the recorded starting version and it is the live one, still running the receipt's
 * exact script and build fingerprint, with the other secret names unchanged: adopt its version. A confirming PUT also records its
 * own starting version before it writes; its immediate successor can be recovered by the
 * same checks. A several-secret copy must also carry its marker; one uploaded but never deployed
 * is deployed by `deployCopy` when given. Anything later is left to the identity check, which refuses it. */
export async function settlePendingSecret(api, worker, state, {preflight = false, observe, confirm, deployCopy} = {}) {
  if (!state.pendingSecret || !state.receipt) return false;
  const live = await activeWorker(api, worker);
  if (sameDeployment(live, state.receipt.provider)) {
    // Both deployment and newest version must corroborate an unapplied write.
    // A stale deployment alone must not erase an accepted but unsettled intent.
    const versions = (await api.request(`/workers/scripts/${worker}/versions`))?.items;
    const listed = Array.isArray(versions) && versions.every(item => uuid(item?.id)) && new Set(versions.map(item => item.id)).size === versions.length;
    const unchanged = listed && versions[0]?.id === live.versionId;
    const copy = listed && !unchanged && deployCopy ? await undeployedCopy(api, worker, state, versions) : null;
    if (copy) { await deployCopy(copy); return settlePendingSecret(api, worker, state, {preflight, observe, confirm}); }
    observe?.(unchanged ? live : null);
    if (!preflight || !unchanged) return false;
    delete state.pendingSecret;
    return true;
  }
  observe?.(live);
  if (state.pendingSecret.versionId !== state.receipt.provider.versionId || !live || live.etag !== state.receipt.provider.etag || deployedFingerprint(live.settings) !== state.receipt.fingerprint) return false;
  // Newest first, as the provider lists them.
  const versions = (await api.request(`/workers/scripts/${worker}/versions`))?.items;
  const ids = Array.isArray(versions) ? versions.map(item => item?.id) : [];
  if (!ids.every(uuid) || new Set(ids).size !== ids.length) return false;
  const {versionId, repeatVersionId} = state.pendingSecret;
  const immediate = ids.indexOf(versionId) === 1;
  const repeated = repeatVersionId && ids[1] === repeatVersionId && ids.indexOf(versionId) === 2;
  // A rotation's ambiguous first answer requires a second PUT before success.
  // Its starting version is saved before that PUT, so interruption can recover
  // either the original immediate successor or the second write's successor.
  if (ids[0] !== live.versionId || !(repeatVersionId ? repeated || preflight && immediate && live.versionId === repeatVersionId : immediate)) return false;
  if (state.pendingSecret.copy && live.version?.annotations?.['workers/message'] !== copyMessage(state.pendingSecret.copy)) return false;
  const rows = await api.request(`/workers/scripts/${worker}/secrets`);
  const names = secretNames(rows), {bindings, present} = state.pendingSecret;
  if (!names || bindings.some(binding => names.includes(binding) !== present)) return false;
  const priorNames = await pendingSecretNames(api, worker, state);
  const otherNames = names.filter(name => !bindings.includes(name));
  if (!priorNames || priorNames.length !== otherNames.length || !priorNames.every(name => otherNames.includes(name))) return false;
  if (confirm && !repeatVersionId) { await confirm(live); return false; }
  recordSecretChange(state, live, state.pendingSecret);
  return true;
}
/** Settle a pending secret change under the state lock, before a plan reads the retired list. */
export async function settleOwnerState({api: provider, target, statePath}) {
  const api = withScopeHints(provider);
  return withStateLock(statePath, async () => {
    const state = await readOwnerState(statePath, target);
    if (await settlePendingSecret(api, target.worker, state, {preflight:true})) await writeOwnerState(statePath, state);
    return state;
  });
}
export const sameDeployment = (a, b) => a?.versionId === b?.versionId && a?.deploymentId === b?.deploymentId && a?.etag === b?.etag;

/** Both marks rer's upload puts on a version: the build binding and the version annotation. */
const carriesUpload = (live, fingerprint) => deployedFingerprint(live?.settings) === fingerprint && live.version?.annotations?.['workers/message'] === `rer-deploy:${fingerprint}`;
/** A completed receipt or the exact identity of an interrupted successful upload proves ownership.
 * An upload whose response or readback was lost is this deploy's own when the live version carries
 * the fingerprint saved just before its PUT: rer records its ids, as a completed readback would. */
async function checkWorkerIdentity(api, plan, state, save) {
  const live = await activeWorker(api, plan.worker);
  const pending = state.pendingUpload;
  if (pending && !pending.provider && carriesUpload(live, pending.fingerprint)) {
    pending.provider = {versionId:live.versionId,deploymentId:live.deploymentId,etag:live.etag};
    state.owned.worker = {status:'created'}; await save();
    return live;
  }
  const expected = pending?.provider ?? state.receipt?.provider;
  if (!expected) throw refuse('uncertain-resource-create','worker',plan.worker);
  if (!sameDeployment(live, expected)) throw refuse('owned-resource-replaced','worker',plan.worker);
  return live;
}
async function checkOwnedWorker(api, plan, state, save) {
  const settings = await workerSettings(api, plan.worker);
  if (settings === null) {
    if (state.owned.worker?.status === 'created') throw refuse('owned-resource-missing','worker',plan.worker);
    return null;
  }
  if (!state.owned.worker) throw refuse('resource-name-collision','worker',plan.worker);
  return checkWorkerIdentity(api, plan, state, save);
}

/** One deploy at a time per state file: an exclusive lock file for the whole run. */
export async function withStateLock(path, run) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const lock = `${path}.lock`;
  let handle;
  try { handle = await open(lock,'wx',0o600); }
  catch (error) { throw error.code === 'EEXIST' ? new Error('owner-state-locked') : error; }
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    return await run();
  } finally { try { await handle.close(); } finally { await rm(lock,{force:true}); } }
}

/** Find or create every declared resource under the owner's account, migrate, upload and check health.
 * Ownership preflight precedes provider writes. A re-run of the same build writes nothing. */
export async function ownerDeploy({api: provider, target, plan, artifact, statePath, env = {}, fetch = globalThis.fetch, healthOptions = {}, readiness = {}, settle = {}, declaredSecrets = plan.secrets}) {
  assert(typeof statePath === 'string' && statePath.length, 'missing-owner-state-path');
  const api = withSettledLists(withScopeHints(provider),settle);
  assert(target?.accountId === api.accountId, 'owner-account-mismatch');
  validatePlan(plan); assertOwnerNames(target, plan);
  for (const item of plan.d1) validateMigrations(item.migrations);
  return withStateLock(statePath, () => deployLocked({api, target, plan, artifact, statePath, env, fetch, healthOptions, readiness, settle, declaredSecrets}));
}
async function deployLocked({api, target, plan, artifact, statePath, env, fetch, healthOptions, readiness, settle, declaredSecrets}) {
  const state = await readOwnerState(statePath, target);
  const save = () => writeOwnerState(statePath, state);
  if (await settlePendingSecret(api, target.worker, state, {preflight:true})) await save();
  await checkServiceWorkers(api, plan);
  const priorWorker = await checkOwnedWorker(api, plan, state, save);
  assert(!state.pendingSecret, 'secret-change-unsettled');
  const exists = priorWorker !== null;
  const create = await ownedResourcesToCreate(api, plan, state);
  if (exists) await checkCronOwnership(api, plan);
  // The declared secrets this run uploads; every other one is inherited unchanged.
  const {missing:sentSecrets,unset:unsetSecrets} = await secretBindings(api, plan.worker, plan, env, exists);
  // Record intent before each create. A failed or lost response leaves it pending:
  // absent on resume means create again; present means an uncertain outcome to inspect.
  for (const {kind,item} of create) {
    state.owned[kind][item.name] = {status:'pending'}; await save();
    let row;
    try { row = await resourceKinds[kind].create(api,item); }
    catch (error) {
      if (definiteProviderRefusal(error)) { delete state.owned[kind][item.name]; await save(); }
      throw error;
    }
    assert(findResource([row],kind,item.name) === row, 'invalid-created-resource');
    state.owned[kind][item.name] = {status:'created',...(resourceId(kind,row) === undefined ? {} : {id:resourceId(kind,row)})}; await save();
    await listedAfterCreate(api,kind,item,settle);
  }
  if (!exists && !state.owned.worker) { state.owned.worker = {status:'pending'}; await save(); }
  const window = readiness.window ?? readinessWindow({...(healthOptions.now ? {clock:healthOptions.now} : {}), ...(healthOptions.sleep ? {sleep:healthOptions.sleep} : {}), ...readiness});
  readiness = {...readiness,window};
  const upload = `/workers/scripts/${plan.worker}?bindings_inherit=strict`;
  const observed = {...api, async request(path, options) {
    const sending = path === upload && options?.method === 'PUT';
    if (sending) {
      await checkSavedResourceIdentities(api, state);
      const current = await checkOwnedWorker(api, plan, state, save);
      if (!sameDeployment(priorWorker,current)) throw refuse('owned-resource-replaced','worker',plan.worker);
      state.pendingUpload = {fingerprint:await uploadFingerprint(options.body)}; await save();
    }
    const result = await api.request(path, options);
    if (sending) {
      // A successful upload creates a Worker only when ownership preflight found
      // it absent. Record it before readback, which can fail after creation.
      if (!exists) api.recordCreated?.(`Worker:${plan.worker}`);
      const active = await uploadedWorker({api,worker:plan.worker,upload:result,previous:priorWorker,fingerprint:state.pendingUpload.fingerprint,window});
      state.pendingUpload.provider = {versionId:active.versionId,deploymentId:active.deploymentId,etag:active.etag};
      state.owned.worker = {status:'created'}; await save();
    }
    return result;
  }};
  const receipt = await deploy({api:observed, plan, artifact, artifactSha256:hash(artifact), previousReceipt:state.receipt ?? undefined,
    // Migrations run inside this run's state lock: no other deploy of this install is running.
    createResources:false, uploadWithoutReceipt:true, locked:true, env, fetch, healthOptions, readiness, declaredSecrets,
    onReceipt: async candidate => { if (candidate.changed || !state.receipt) { state.receipt = candidate; delete state.pendingUpload; delete state.pendingSecret; await save(); } },
    // Keep each first-health attempt beside the identity it belongs to.
    onHealth: async candidate => { if (candidate.changed) { state.receipt = candidate; await save(); } }});
  return {receipt, created:create.map(({kind,item}) => `${kind}:${item.name}`), sentSecrets, unsetSecrets, freshUpload:!exists && receipt.changed};
}

/** Independent read-only health of the last owner deployment recorded in the state file. */
export async function ownerHealth({api: provider, target, plan, statePath, fetch = globalThis.fetch, healthOptions = {}}) {
  const api = withSettledLists(withScopeHints(provider));
  validatePlan(plan); assertOwnerNames(target, plan);
  const state = await readOwnerState(statePath, target);
  assert(state.receipt, 'missing-owner-receipt');
  return verifyHealth({...healthOptions, api, plan, receipt:state.receipt, fetch});
}
