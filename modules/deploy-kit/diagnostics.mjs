// Provider text is private until the CLI's existing credential redactor approves
// it. Identity, rather than mutable Error properties, carries this diagnostic.
const failures = new WeakMap();
export function recordDeployFailure(error, details) {
  failures.set(error,{...failures.get(error),...details});
  return error;
}
export function deployDiagnostic(error, redact) {
  const detail = failures.get(error);
  if (!detail) return undefined;
  const clean = value => (redact ?? String)(String(value)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,'').replace(/\b[a-f0-9]{32}\b/gi,'[REDACTED]');
  const failureCode = detail.code ?? error.message;
  const code = /^[a-zA-Z0-9_-]{1,120}$/.test(failureCode) ? clean(failureCode) : 'deploy-failed';
  return {code,step:detail.step ?? 'deploy',created:(detail.created ?? []).map(clean),
    ...(typeof error.resource==='string' && /^(?:d1|r2|kv|queues|worker|service):[a-z0-9-]+$/.test(error.resource) ? {resource:clean(error.resource)} : {}),
    ...(detail.providerCodes?.length ? {providerCodes:detail.providerCodes} : {}),
    ...(redact && providerFailure(error,redact) ? {provider:providerFailure(error,redact)} : {}),
    output:(detail.output ? (redact ? clean(detail.output) : '(provider output withheld; rer deploy provides redacted details)') : '(no provider output)').split(/\r?\n/).slice(0,8).map(line=>line.slice(0,500)).join('\n')};
}
/** One line naming the provider call that was refused and what Cloudflare said, from
 * the error's own `providerRefusal` (set by any copy of the kit); undefined otherwise. */
export function providerRefusal(error, redact = String) {
  const refusal = error?.providerRefusal;
  if (typeof refusal?.operation !== 'string' || !Array.isArray(refusal.errors)) return undefined;
  const said = refusal.errors.map(item => [item?.code, typeof item?.message === 'string' ? redact(item.message).slice(0,300) : undefined].filter(part => part !== undefined && part !== '').join(' ')).filter(Boolean).slice(0,3);
  return `Cloudflare refused ${redact(refusal.operation).slice(0,200)}${said.length ? `: ${said.join('; ')}` : ''}`;
}
/** What a migration that failed or stays refused means for the next run, from the
 * error's own `migration` or `migrationClaim` (set by any copy of the kit) and its
 * `d1:<name>` resource; undefined otherwise. */
export function migrationFailure(error, again = 'rer deploy') {
  const safe = value => String(value).replace(/[^\w. -]/g,'?').slice(0,120);
  const database = /^d1:([a-z0-9-]+)$/.exec(error?.resource ?? '')?.[1];
  const claim = error?.migrationClaim;
  if (typeof claim?.name === 'string') {
    const name = safe(claim.name).replaceAll(' ','?');
    const run = sql => `npx wrangler d1 execute ${database ?? '<database>'} --remote --command "${sql} WHERE name='${name}' AND state='applying'"`;
    const present = (Array.isArray(claim.present) ? claim.present : []).slice(0,5).map(safe);
    return `Migration ${name} in ${database ? `D1 ${database}` : 'its D1 database'} was started but never confirmed, and rer runs it again only when it can prove none of it applied. ${present.length
      ? `Some of its changes are present (${present.join(', ')}). Undo them so the database is as it was before ${name}, then run ${again} again: rer checks again and runs it.`
      : `It creates no table, index, view, trigger or column, so rer cannot check whether it applied. If none of its changes are present, delete its claim with ${run('DELETE FROM d1_migrations')}, then run ${again} again.`} If it did apply in full, record that instead with ${run("UPDATE d1_migrations SET state='applied'")}.`;
  }
  if (typeof error?.migration === 'string') return `Migration ${safe(error.migration)} did not apply; the next ${again} runs it again once rer proves none of it applied.`;
  return undefined;
}
/** Safe call identity travels with errors from independently vendored kits. */
export function providerTransport(error, redact = String) {
  const detail = error?.providerTransport;
  if (typeof detail?.operation !== 'string' || typeof detail.endpoint !== 'string') return undefined;
  const clean = value => redact(value).replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').replace(/\b[a-f0-9]{32}\b/gi,'[REDACTED]').slice(0,300);
  const attempts = detail.attempts === 2 ? ' after 2 attempts' : '';
  const status = Number.isInteger(detail.status) ? `while reading HTTP ${detail.status}` : 'before any HTTP status';
  return `Cloudflare transport failed for ${clean(detail.operation)} at ${clean(detail.endpoint)} ${status}${attempts}${typeof detail.reason === 'string' ? `: ${clean(detail.reason)}` : ''}`;
}
function operation(path, options = {}) {
  const write = options.method && options.method !== 'GET';
  if (/\/d1\/database\/[^/]+\/query/.test(path)) return 'migrate D1';
  for (const [prefix,kind] of [['/d1/database','D1'],['/r2/buckets','R2'],['/queues','queue'],['/storage/kv/namespaces','KV']]) {
    if (path === prefix && options.method === 'POST') return `create ${kind}`;
    if (path.startsWith(prefix)) return `check ${kind}`;
  }
  if (path.includes('/secrets')) return 'secrets';
  if (path.includes('/subdomain') || path.includes('/routes') || path.includes('/domains')) return 'route';
  if (path.includes('/schedules')) return 'scheduled triggers';
  if (write && path.startsWith('/workers/')) return 'upload Worker';
  return 'check Worker';
}
const CREATED_KINDS = {D1:'d1',R2:'r2',KV:'kv',queue:'queues'};
export function deploymentDiagnostics(api, {onCreated} = {}) {
  const created = [];
  const recordCreated = resource => { created.push(resource); onCreated?.(resource); };
  let currentStep = 'prepare deploy', currentCall;
  const guard = method => async (path, options) => {
    const step = operation(path,options);
    currentStep = step;
    currentCall = `${method === 'list' ? 'GET' : options?.method ?? 'GET'} ${path.split('?')[0].replace(/(\/r2\/buckets\/[^/]+\/objects)\/.*/, '$1/[object]')}`;
    try {
      const result = await api[method](path,options);
      if (step.startsWith('create ')) recordCreated(`${step.slice(7)}:${options.body.name ?? options.body.queue_name ?? options.body.title}`);
      return result;
    } catch (error) {
      // A failed create names the resource it asked for: a lost answer may still have created it.
      if (step.startsWith('create ') && error.resource === undefined) error.resource = `${CREATED_KINDS[step.slice(7)]}:${options.body.name ?? options.body.queue_name ?? options.body.title}`;
      error.providerCall ??= {operation:currentCall,reason:error.message};
      throw recordDeployFailure(error,{step,created:[...created]});
    }
  };
  return {...api,request:guard('request'),list:guard('list'),envelope:guard('envelope'),recordCreated,
    async importSql(id, sql) {
      currentStep = 'migrate D1';
      try { return await api.importSql(id, sql); }
      catch (error) { throw recordDeployFailure(error,{step:currentStep,created:[...created]}); }
    },
    annotateFailure(error, step = currentStep) {
      const prior = failures.get(error);
      if (currentCall) error.providerCall ??= {operation:currentCall,reason:error.message};
      // Node filesystem/CLI codes are structural; their messages can hold paths
      // and inputs, so retain them privately for the caller's redaction boundary.
      const cliCode = typeof error.code === 'string' && /^(?:E[A-Z0-9_]{1,63}|health-[a-z-]+)$/.test(error.code) ? error.code : undefined;
      recordDeployFailure(error,{step:prior?.step ?? step,created:prior?.created ?? [...created],
        ...(!prior?.code && cliCode ? {code:cliCode,...(!prior?.output ? {output:error.message} : {})} : {})});
      return error;
    }};
}

/** All provider failure paths share the same safe, portable rendering. */
export function providerFailure(error, redact = String) {
  const specific = providerRefusal(error,redact) ?? providerTransport(error,redact);
  if (!specific && error?.cause instanceof Error) return providerFailure(error.cause,redact);
  if (specific) return specific;
  const call = error?.providerCall;
  if (typeof call?.operation !== 'string') return undefined;
  const clean = value => redact(String(value)).replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').replace(/\b[a-f0-9]{32}\b/gi,'[REDACTED]').slice(0,300);
  return `Cloudflare call ${clean(call.operation)}: ${clean(call.reason ?? error.message)} (no Cloudflare error code or message supplied)`;
}

// Asset paths are build inputs; the CLI still redacts them before display.
export function nameAssetFailure(error, paths, status = error.status ?? error.providerTransport?.status) {
  error.assetFailure = {paths, status};
  return error;
}
export function assetFailure(error, redact = String) {
  const detail = error?.assetFailure;
  if (!Array.isArray(detail?.paths)) return undefined;
  const names = detail.paths.slice(0,8).map(path => redact(String(path)).replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').slice(0,300));
  return `Asset ${names.join(', ')}${detail.paths.length > 8 ? ` (+${detail.paths.length - 8} more)` : ''}: ${Number.isInteger(detail.status) ? `HTTP ${detail.status}` : 'no HTTP status (transport failure)'}`;
}
