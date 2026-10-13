import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contained } from './project.mjs';
import { shared } from './shared.mjs';
import { refuse, missing } from './errors.mjs';
import { aiConfig, aiDiagnostics } from '../modules/ai/index.mjs';
import { validBaseUrl } from '../modules/ai/config.mjs';

export const MODELS_FILE = '.rer/local/models.json';
export async function readLiveModels(root) {
  let file;
  try { file = await contained(root, MODELS_FILE, { privateFile: true }); }
  catch (error) { if (error.code === 'missing_input') return null; throw error; }
  for (const path of ['.rer', '.rer/local', MODELS_FILE]) {
    const status = await lstat(join(root, path));
    if ((status.mode & 0o777) !== (path === MODELS_FILE ? 0o600 : 0o700) || (process.getuid && status.uid !== process.getuid())) throw refuse('Live-dev Models storage requires owned directories 0700 and models.json 0600.');
  }
  let values;
  try { values = JSON.parse(await readFile(file, 'utf8')); } catch { throw refuse('The local Models dev-app file is malformed.'); }
  if (!validBaseUrl(values.service) || typeof values.key !== 'string' || !/^mdl_[A-Za-z0-9_-]{16,}$/.test(values.key)) throw refuse('Use a Models URL and a dev-app key in the local Models file. Provider keys are refused.');
  return { baseUrl: values.service, apiKey: values.key };
}

/** URL is nonsecret; a dev-app key enters through stdin only, never argv. */
export async function prepareLiveModels(root, options, store, signal) {
  if ((options.models ?? 'fake') !== 'live') return undefined;
  let live = await readLiveModels(root);
  if (options.modelsService) {
    if (live) throw refuse('A local Models key already exists. Remove models.json explicitly to replace it.');
    if (!validBaseUrl(options.modelsService) || process.stdin.isTTY) throw refuse('Pipe the dev-app key on stdin with --models live --models-service URL.');
    let key = '';
    for await (const chunk of process.stdin) { key += chunk; if (key.length > 4096) throw refuse('The Models key input is too large.'); }
    key = key.trim();
    if (!/^mdl_[A-Za-z0-9_-]{16,}$/.test(key)) throw refuse('Use a Models dev-app key; provider keys are refused.');
    const { privateDirectory, writePrivateFile } = await shared('private-files.mjs');
    const directory = await privateDirectory(root, ['.rer', 'local']);
    await writePrivateFile(join(directory, 'models.json'), JSON.stringify({ service: options.modelsService, key }) + '\n');
    live = await readLiveModels(root);
  }
  if (!live) throw missing('Live dev needs .rer/local/models.json. Create a capped, expiring, cheap-models-only Models dev app, then pipe its key with --models-service URL.');
  store.addSecrets([live.apiKey]);
  const url = live.baseUrl.replace(/\/$/, '') + (live.baseUrl.replace(/\/$/, '').endsWith('/v1') ? '/models' : '/v1/models');
  let providers;
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${live.apiKey}` }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
    if (!response.ok) { await response.body?.cancel(); throw Error(); }
    const listing = await response.json();
    providers = [...new Set(listing.data.flatMap(model => model.providers))];
    if (!providers.length || !providers.every(provider => typeof provider === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(provider))) throw Error();
  } catch { throw refuse('The Models dev app could not list its allowed providers. No live-dev server was started.'); }
  store.report(`RER_MODELS_LIVE ${new URL(live.baseUrl).origin} via ${providers.join(', ')}`);
  return live;
}

export async function localAiDiagnostics(project, overrides = {}) {
  let values = {};
  try {
    const { readSettings } = await shared('adapter-settings.mjs');
    if (project.adapter?.hooks?.secrets) values = (await readSettings(project.root, project.adapter.hooks.secrets)).values;
  } catch {}
  const issues = aiDiagnostics(aiConfig({ ...values, ...overrides }, project.adapter?.ai?.features));
  try { await readLiveModels(project.root); }
  catch { issues.push({ feature: 'live-dev', code: 'ai_misconfigured', message: 'The local Models dev-app file or its permissions are unsafe.' }); }
  return issues;
}
