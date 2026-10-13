import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { contract } from '../contract.mjs';
import { overviewMode, overviewViewports, readOnlyOverviewRequest, assertOverviewState, checklistIds } from '../../scripts/owner-session/overview-contract.mjs';
import { commands } from '../../scripts/owner-session/commands.mjs';

const origin = 'https://dial-session-check.example.workers.dev';
const expectedUrl=origin+'/book/qa/proof';
const state = () => {
 const steps=checklistIds.map(id=>({id,done:id!=='calendar'}));
 return {mail:{state:'healthy',checkedAt:'2026-10-07T00:00:00Z'},platform:{checkedAt:'2026-10-07T00:00:00Z',checks:{database:'ok',storage:'ok',queue:'ok'}},calendar:{state:'disconnected',reason:'not_connected',checkedAt:null},links:[{url:expectedUrl,requestOnly:true,copiedAt:'2026-10-07T00:00:00Z'}],steps,checklist:structuredClone(steps)};
};

contract('BASE-SECRET-001', 'owner Overview dispatch and capture cover both widths without granting Google or mutation access', () => {
  assert.deepEqual(commands.overview, ['owner-session/overview.mjs']);
  assert.deepEqual(commands['export-proof'], ['owner-session/export-install.mjs']);
  const tripwire = `import net from 'node:net'; import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw new Error('forbidden-offline-effect');}; globalThis.fetch=deny; net.Socket.prototype.connect=deny; cp.execFileSync=deny; cp.spawn=deny; syncBuiltinESMExports();`;
  for(const command of ['overview','export-proof','acknowledgement']){
  const dispatch = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(tripwire)}`, 'scripts/owner-session/run.mjs', '--dry-run', command, 'connected'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(dispatch.status, 0, dispatch.stderr);
  assert.deepEqual(JSON.parse(dispatch.stdout), { ok: true, scope: 'offline-dispatch-only', command, dispatch: commands[command], argumentCount: 1, networkCalls: 0, deployed: false, liveProof: false });
  }
  assert.deepEqual(overviewViewports, [{ width: 1440, height: 900 }, { width: 390, height: 844 }]);
  assert.equal(overviewMode(), 'requests');
  assert.equal(overviewMode('connected'), 'connected');
  assert.throws(() => overviewMode('connect-google'));
  assert.equal(readOnlyOverviewRequest('GET', `${origin}/app`, origin), true);
  assert.equal(readOnlyOverviewRequest('GET', `${origin}/api/app/mail/connection`, origin), true);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(readOnlyOverviewRequest(method, `${origin}/api/app/profile`, origin), false);
  assert.equal(readOnlyOverviewRequest('GET', 'https://www.googleapis.com/calendar/v3/calendars', origin), false);
  assert.equal(readOnlyOverviewRequest('GET', `${origin}/api/calendar/oauth/start`, origin), false);
  assert.equal(readOnlyOverviewRequest('GET', `${origin}/api/app/calendar/calendars`, origin), false);
  assert.equal(readOnlyOverviewRequest('GET', `${origin}/api/app/calendar/connection`, origin), true);
});
contract('CAL-006', 'requests capture requires healthy bindings, checked times, six completed steps and disconnected Calendar', () => {
  assert.equal(assertOverviewState(state(), 'requests', expectedUrl), true);
  for (const change of [x => { x.mail.state = 'unavailable'; }, x => { x.platform.checks.queue = 'unavailable'; }, x => { x.mail.checkedAt = null; }, x => { x.checklist[0].done = false; }, x => { x.calendar.state = 'healthy'; }, x => { x.links[0].requestOnly = false; }, x => { x.checklist[0].id = 'mail'; }]) { const value = state(); change(value); assert.throws(() => assertOverviewState(value, 'requests', expectedUrl)); }
});
contract('CAL-006', 'after owner connection capture requires healthy Calendar and every checklist step complete', () => {
  const value = state();
  assert.throws(() => assertOverviewState(value, 'connected', expectedUrl));
  value.calendar.state = 'healthy';value.calendar.checkedAt='2026-10-07T00:00:00Z';
  assert.throws(() => assertOverviewState(value, 'connected', expectedUrl), /checklist-incomplete/);
  value.checklist.forEach(step => { step.done = true; });value.steps.forEach(step=>{step.done=true;});
  assert.equal(assertOverviewState(value, 'connected', expectedUrl), true);
  value.calendar.state = 'reauthorization_required';
  assert.throws(() => assertOverviewState(value, 'connected', expectedUrl), /calendar-not-healthy/);
});

contract('CAL-006','Overview refuses missing current copy, availability, cause and calendar timestamps',()=>{
 for(const change of [x=>{x.links[0].copiedAt=null;},x=>{x.links[0].url=origin+'/book/other/event';},x=>{x.calendar.reason=null;},x=>{x.steps.find(s=>s.id==='availability').done=false;x.checklist.find(s=>s.id==='availability').done=false;}]){const value=state();change(value);assert.throws(()=>assertOverviewState(value,'requests',expectedUrl));}
 const value=state();value.calendar.state='healthy';value.steps.forEach(s=>{s.done=true;});value.checklist.forEach(s=>{s.done=true;});assert.throws(()=>assertOverviewState(value,'connected',expectedUrl),/calendar-not-healthy/);
 for(const path of ['/api/app/platform-health','/health'])assert.equal(readOnlyOverviewRequest('GET',origin+path,origin),true);
 assert.equal(readOnlyOverviewRequest('POST',origin+'/api/app/event-types/event/copy-report',origin),false);
});
