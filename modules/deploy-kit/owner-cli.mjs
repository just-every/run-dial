import { readinessWindow, rememberReadiness } from './readiness-window.mjs';
import { deploymentDiagnostics, deployDiagnostic } from './diagnostics.mjs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assert, hexId } from './validation.mjs';
import { regularBytes } from './artifact.mjs';
import { packageBuild } from './prepare.mjs';
import { cloudflare } from './provider.mjs';
import { ownerTarget, ownerPlan, ownerDeploy, ownerHealth, settleOwnerState, sameDeployment, localOnlyBinding, withStateLock, readOwnerState, writeOwnerState } from './owner.mjs';
import { activeWorker } from './worker.mjs';
import { ownerSecret } from './owner-secret.mjs';
import { ownerRemove } from './owner-remove.mjs';
import { ownerSignin } from './owner-signin.mjs';
import { refuseLocalModels } from './local-only.mjs';

export const cronNotice = 'This Worker has a Cron Trigger. Cloudflare may take up to about two hours to start its first scheduled run on some accounts.';
const usage = 'usage: owner-cli.mjs deploy|health|remove|inspect|record-owner|signin --declaration <file> --environment <name> [--product <dir>] [--state <file>] [--outcome claimed|kept] | secret ... --set NAME|--unset NAME';

/** The owner's committed source and existing local build. Run the seed's build first. */
async function ownerArtifact(root, product) {
  const git = (...args) => { try { return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); } catch { throw new Error('owner-source-not-a-git-checkout'); } };
  const source = {sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
  assert(!git('status','--porcelain','--untracked-files=no'),'owner-source-not-committed');
  return packageBuild({root,source,runIdentity:{id:'0',attempt:'1'},productDirectory:product});
}

/** Inputs: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, plus the secrets the declaration names on first deploy. */
export async function main(argv = process.argv.slice(2), env = process.env, {fetch = globalThis.fetch, cwd = process.cwd(), healthOptions, propagation, settle, localOnlyKeys = [], notice = line => console.error(line), onCreated} = {}) {
  let parsed;
  try { parsed = parseArgs({args:argv,allowPositionals:true,strict:true,options:{declaration:{type:'string'},environment:{type:'string'},product:{type:'string',default:''},state:{type:'string'},set:{type:'string'},unset:{type:'string'},outcome:{type:'string'}}}); }
  catch { throw new Error('usage'); }
  const {positionals:[command,...rest],values} = parsed;
  if (!['deploy','health','secret','remove','inspect','record-owner','signin'].includes(command) || rest.length || !values.declaration || !values.environment) throw new Error('usage');
  if ((command === 'secret') !== (values.set !== undefined || values.unset !== undefined) || values.set !== undefined && values.unset !== undefined) throw new Error('usage');
  if (values.outcome !== undefined && command !== 'record-owner' || command === 'record-owner' && !['claimed','kept'].includes(values.outcome)) throw new Error('usage');
  await refuseLocalModels(resolve(cwd));
  const missing = ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN'].filter(key => typeof env[key] !== 'string' || !env[key].trim());
  if (missing.length) { const error = new Error('missing-input'); error.inputs = missing; throw error; }
  assert(hexId(env.CLOUDFLARE_ACCOUNT_ID) && !/[\r\n]/.test(env.CLOUDFLARE_API_TOKEN),'invalid-cloudflare-input');
  const root = resolve(cwd);
  let declaration;
  try { declaration = JSON.parse(await regularBytes(resolve(root,values.declaration),256 * 1024)); }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'missing-owner-declaration' : 'invalid-owner-declaration'); }
  assert(typeof declaration?.project === 'string','missing-owner-project');
  // Removal reads identity before each object DELETE and may span many pages.
  // Bound each response, not the owner's bucket size; failures retain ownership.
  let requestWindow = propagation?.freshUpload ? propagation.window : undefined;
  const request = fetch;
  fetch = (input, init = {}) => {
    if (!requestWindow?.active) return request(input, init);
    const remaining = requestWindow.remaining();
    assert(remaining > 0, 'deployment-readiness-timeout');
    const deadline = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
    return request(input, {...init,signal:init.signal ? AbortSignal.any([init.signal,deadline]) : deadline});
  };
  const api = deploymentDiagnostics(cloudflare({accountId:env.CLOUDFLARE_ACCOUNT_ID,token:env.CLOUDFLARE_API_TOKEN,fetch,...(command === 'remove' ? {maxRequests:Infinity} : {})}),{onCreated});
  const target = await ownerTarget(api,{project:declaration.project,environment:values.environment});
  const statePath = values.state ? resolve(root,values.state) : join(root,'.rer','deploy',`${target.environment}.json`);
  if (command === 'remove') return {ok:true,...await ownerRemove({api,target,statePath}).catch(error => { throw api.annotateFailure(error,'remove'); })};
  if (command === 'secret') {
    const binding = values.set ?? values.unset, item = (Array.isArray(declaration.secrets) ? declaration.secrets : []).find(entry => entry?.binding === binding);
    if (!item) { const error = new Error('undeclared-secret'); error.resource = `secret:${binding}`; throw error; }
    const value = values.set === undefined ? undefined : env[item.environment];
    return {ok:true,...await ownerSecret({api,target,statePath,binding,value,fetch,healthOptions}).catch(error => { throw api.annotateFailure(error,'secrets'); })};
  }
  // A secret rer retired (the spent setup token) is no longer part of the plan.
  const state = await settleOwnerState({api,target,statePath});
  const {retiredSecrets = []} = state;
  if (command === 'record-owner') return withStateLock(statePath, async () => {
    const current = await readOwnerState(statePath, target);
    assert(current.receipt && !current.pendingUpload && !current.pendingSecret, 'missing-owner-receipt');
    const live = await activeWorker(api, target.worker);
    assert(live && sameDeployment(live, current.receipt.provider), 'owned-resource-replaced');
    current.ownerClaim = { outcome: values.outcome };
    await writeOwnerState(statePath, current);
    return {ok:true, owner:values.outcome};
  });
  // The link is a credential: returned to the caller once, never written to the state file.
  if (command === 'signin') return {ok:true,...await ownerSignin({api,target,statePath}).catch(error => { throw api.annotateFailure(error,'signin'); })};
  if (command === 'inspect') {
    assert(!localOnlyBinding(declaration, localOnlyKeys), 'local-only-binding');
    assert(state.receipt && !state.pendingUpload && !state.pendingSecret, 'missing-owner-receipt');
    const live = await activeWorker(api, target.worker);
    assert(live && sameDeployment(live, state.receipt.provider), 'owned-resource-replaced');
    const rows = await api.request(`/workers/scripts/${target.worker}/secrets`);
    assert(Array.isArray(rows), 'invalid-secret-list');
    return {ok:true, origin:target.origin, versionId:live.versionId, retiredSecrets, ownerClaim:state.ownerClaim, liveSecrets:rows.map(row => row.name)};
  }
  const current = retiredSecrets.length && Array.isArray(declaration.secrets) ? {...declaration,secrets:declaration.secrets.filter(item => !retiredSecrets.includes(item?.binding))} : declaration;
  const artifact = await ownerArtifact(root,values.product);
  const plan = ownerPlan(target,current,artifact,{localOnlyKeys});
  if (command === 'health') {
    const readiness = {...(healthOptions?.now ? {clock:healthOptions.now} : {}), ...(healthOptions?.sleep ? {sleep:healthOptions.sleep} : {}),
      ...healthOptions?.readiness,single:true,totalMs:30000,
      ...(propagation ? {window:propagation.window,freshUpload:propagation.freshUpload && propagation.versionId === state.receipt?.provider.versionId} : {})};
    await ownerHealth({api,target,plan,statePath,fetch,healthOptions:{...healthOptions,readiness}}).catch(error=>{throw api.annotateFailure(error,'health');});
    return {ok:true,worker:target.worker,origin:target.origin};
  }
  // Dispatch is the provider's: on some accounts a new Cron starts only at the account scheduler's next refresh.
  if (plan.crons.length) notice(cronNotice);
  // The fingerprint names every declared secret, retired ones too: an untouched repeat after the claim is a no-op.
  const declaredSecrets = current === declaration ? plan.secrets : ownerPlan(target,declaration,artifact,{localOnlyKeys}).secrets;
  const window = readinessWindow({...(healthOptions?.now ? {clock:healthOptions.now} : {}), ...(healthOptions?.sleep ? {sleep:healthOptions.sleep} : {}), ...healthOptions?.readiness});
  requestWindow = window;
  const {receipt,created,sentSecrets,freshUpload} = await ownerDeploy({api,target,plan,artifact,statePath,env,fetch,healthOptions,readiness:{...healthOptions?.readiness,window},settle,declaredSecrets}).catch(error => {
    api.annotateFailure(error,error.message.startsWith('missing-secret-') ? 'secrets' : undefined);
    throw error;
  });
  const result = {ok:true,changed:receipt.changed,worker:target.worker,origin:receipt.origin,versionId:receipt.provider.versionId,created,sentSecrets,retiredSecrets,...(state.ownerClaim ? {ownerClaim:state.ownerClaim} : {}),state:statePath};
  const sentTokens = new Map(sentSecrets.map(binding => [binding,env[declaration.secrets.find(item => item.binding === binding)?.environment]]));
  Object.defineProperty(result, 'propagation', {value: {window,freshUpload,sentSecrets,versionId:receipt.provider.versionId,
    matchesToken:(binding,token) => sentTokens.has(binding) && sentTokens.get(binding) === token}});
  rememberReadiness(result);
  return result;
}

/** Prints refusal codes and resource names only; never inputs, tokens or provider bodies. */
export function report(error) {
  const diagnostic = deployDiagnostic(error);
  if (diagnostic) return {ok:false,...diagnostic};
  if (error.message === 'missing-input') return {ok:false,code:'missing-input',inputs:error.inputs};
  if (error.message === 'usage') return {ok:false,code:'usage',usage};
  return {ok:false,code:/^[a-zA-Z0-9_-]{1,120}$/.test(error.message) ? error.message : 'owner-deploy-failed',...(error.resource ? {resource:error.resource} : {})};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main())); }
  catch (error) { console.error(JSON.stringify(report(error))); process.exitCode = error.message === 'local-only-binding' ? 4 : 1; }
}
