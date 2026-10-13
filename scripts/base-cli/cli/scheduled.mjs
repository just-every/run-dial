import { declaredCronSources } from './deploy-config.mjs';

// `rer dev` runs the project's declared Cron Triggers (wrangler `triggers.crons`, from wrangler.jsonc, wrangler.toml or a deploy template)
// on their schedule by calling the local runtime's scheduled test endpoint (the Vite plugin's under dev, Miniflare's own under preview), so
// alerts, retries and checks behave on the owner's computer as they do deployed.

const fields = [[0, 59], [0, 23], [1, 31], [1, 12], [1, 7]];

function field(text, [low, high]) {
 const values = new Set();
 for (const part of text.split(',')) {
  const match = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
  if (!match) throw new Error(`Unsupported cron field "${text}"`);
  const step = match[4] === undefined ? 1 : Number(match[4]);
  const start = match[1] ? low : Number(match[2]), end = match[1] ? high : match[3] === undefined ? (match[4] === undefined ? start : high) : Number(match[3]);
  if (!step || start < low || end > high || start > end) throw new Error(`Cron field "${text}" is out of range`);
  for (let value = start; value <= end; value += step) values.add(value);
 }
 return values;
}

// Same grammar the deploy kit accepts: five numeric fields with lists, ranges and
// steps, in UTC. Day of week counts 1 (Sunday) to 7 (Saturday), as Cloudflare does.
export function parseCron(expression) {
 const parts = expression.trim().split(/\s+/);
 if (parts.length !== 5) throw new Error(`Cron "${expression}" needs five fields`);
 const [minute, hour, day, month, weekday] = parts.map((part, index) => field(part, fields[index]));
 return { minute, hour, day, month, weekday, dayRestricted: parts[2] !== '*', weekdayRestricted: parts[4] !== '*' };
}

export function cronMatches(cron, date) {
 const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
 const day = parsed.day.has(date.getUTCDate()), weekday = parsed.weekday.has(date.getUTCDay() + 1);
 const days = parsed.dayRestricted && parsed.weekdayRestricted ? day || weekday : day && weekday;
 return parsed.minute.has(date.getUTCMinutes()) && parsed.hour.has(date.getUTCHours()) && parsed.month.has(date.getUTCMonth() + 1) && days;
}

// The Cron Triggers a project declares, read from the same files `rer check` reads
// for the deployed Worker (deploy-config.mjs). Two files that both declare
// triggers.crons must declare the same ones: otherwise `rer dev` would run a
// schedule the deployed Worker does not have.
export async function declaredCrons(root, adapter) {
 const sources = await declaredCronSources(root, adapter);
 for (const { path, crons } of sources) for (const cron of crons) parseCron(cron);
 const [first, ...others] = sources;
 const clash = others.find(({ crons }) => crons.length !== first.crons.length || crons.some(cron => !first.crons.includes(cron)));
 if (clash) throw new Error(`${first.path} declares ${JSON.stringify(first.crons)} but ${clash.path} declares ${JSON.stringify(clash.crons)}; make them the same.`);
 return first?.crons ?? [];
}

// Fire each matching cron at the start of its minute until `signal` aborts.
// `report` receives one record per run: { cron, ok, status?, ms, error? }.
export function runScheduled({ crons, url, path = '/cdn-cgi/handler/scheduled', signal, report, now = () => new Date(), fetchImpl = fetch, runTimeout = 300000 }) {
 const parsed = crons.map(cron => [cron, parseCron(cron)]), running = new Set();
 let timer;
 const settled = new Promise(resolve => {
  const finish = () => { clearTimeout(timer); resolve(); };
  if (signal.aborted) return finish();
  signal.addEventListener('abort', finish, { once: true });
  const wait = () => { timer = setTimeout(tick, 60000 - (now().getTime() % 60000) + 250); };
  const tick = () => {
   const minute = now();
   for (const [cron, expression] of parsed) if (cronMatches(expression, minute)) void run(cron);
   wait();
  };
  async function run(cron) {
   if (running.has(cron)) { report({ cron, ok: false, skipped: true, error: 'previous run still in progress' }); return; }
   running.add(cron);
   const started = Date.now();
   try {
    const response = await fetchImpl(`${url}${path}?cron=${encodeURIComponent(cron)}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(runTimeout)]) });
    await response.body?.cancel();
    report({ cron, ok: response.ok, status: response.status, ms: Date.now() - started });
   } catch (error) {
    if (!signal.aborted) report({ cron, ok: false, ms: Date.now() - started, error: error.name === 'TimeoutError' ? 'timed out' : 'the runtime did not answer' });
   } finally { running.delete(cron); }
  }
  wait();
 });
 return settled;
}
