import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recordVolumeOwner } from './lock.mjs';
import { incoming, outgoing } from './ingress.mjs';
import { parseCron, cronMatches } from '../../cli/scheduled.mjs';
import { superviseRunner } from './runner.mjs';
export async function startHost({ root = '/app', data = '/data', settings = process.env, port = Number(process.env.PORT ?? 8080), edge, engineVersion = process.version, automaticTicks=true, runnerEnabled=true } = {}) {
 await mkdir(data, { recursive:true });
 const manifest = JSON.parse(await readFile(join(root, 'container.json'), 'utf8'));
 const release = await recordVolumeOwner(data);
 let engine, server, timer, idleTimer, runner, closing, lastMinute = -1, lastRequest=Date.now();
 try {
  const create = manifest.engine === 'node' ? (await import('./node-engine.mjs')).nodeEngine : (await import('./worker-engine.mjs')).workerEngine;
  engine = await create({ root,data,manifest,settings,edge });
  const schedules = (manifest.config.triggers?.crons ?? []).map(cron => [cron,parseCron(cron)]);
  const tick = async time => { for (const [cron, expression] of schedules) if (cronMatches(expression, new Date(time))) await engine.scheduled({ cron,scheduledTime:time }); await engine.drain(); };
  server = createServer(async (req, res) => {
   try {
    lastRequest=Date.now();
    const request = await incoming(req, { trustedProxy:settings.TRUSTED_PROXY, maxRequestBytes:manifest.maxRequestBytes });
    let response = await engine.fetch(request);
    if (new URL(request.url).pathname === '/health' && response.ok) {
     const body = await response.json(); const deadJobs = engine.dead();
     response = Response.json({ ...body, platform:'container', deployment:{ ...body.deployment, platform:'container', versionId:settings.RER_IMAGE_DIGEST ?? null }, container:{ engine:manifest.engine,engineVersion,deadJobs,runner:manifest.runner ? (runner?.running() ? 'running' : 'stopped') : null } }, { status:deadJobs || (manifest.runner && runnerEnabled && !runner?.running()) ? 503 : response.status,headers:response.headers });
    }
    outgoing(response, res);
   } catch (cause) { res.statusCode = cause.status ?? 500; res.end('Container request failed'); console.error('Container request failed:', cause.name); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port,'0.0.0.0',resolve); });
  let ticking=false;
  if(automaticTicks){timer = setInterval(async () => { if(ticking)return;ticking=true;const minute = Math.floor(Date.now()/60000); try { if (minute !== lastMinute) { lastMinute = minute; await tick(minute * 60000); } else await engine.drain(); } catch { console.error('Container scheduled event failed'); }finally{ticking=false;} },1000); timer.unref();}
  const close = () => closing ??= (async () => { clearInterval(timer); clearInterval(idleTimer); await runner?.close(); await new Promise(resolve => server.close(resolve)); await engine.close(); await release(); })();
  const idle=Number(settings.RER_CONTAINER_IDLE_SECONDS);if(Number.isFinite(idle)&&idle>0){idleTimer=setInterval(()=>{if(Date.now()-lastRequest>=idle*1000)void close();},Math.min(1000,idle*1000));idleTimer.unref();}
  if(runnerEnabled)runner=superviseRunner({root,manifest,settings,failed(){console.error('Required container runner stopped');void close().finally(()=>{process.exitCode=1;});}});
  return { engine,manifest,server,tick,close };
 } catch (cause) { clearInterval(timer); clearInterval(idleTimer); await runner?.close(); server?.close(); await engine?.close(); await release(); throw cause; }
}
if (process.argv[1] === import.meta.filename) {
 let host;
 try { host = await startHost(); console.log('RER_CONTAINER_READY'); } catch (cause) { console.error('Container startup failed:', cause.message?.match(/^[a-z-]+$/)?.[0] ?? cause.name); process.exitCode=1; }
 if (host) for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async () => { await host.close(); process.exit(0); });
}
