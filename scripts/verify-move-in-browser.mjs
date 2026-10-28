import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { assertReport } from '../tests/move-in/report-validator.mjs';
import { evidencePath } from './evidence-path.mjs';
import { assertNativeImportedHistory } from './move-in-browser-history.mjs';
import { catchUpJourney, switchOverJourney } from './move-in-browser-catch-up.mjs';
import { schedulerJourney } from './move-in-browser-schedulers.mjs';
const origin=process.env.DIAL_REVIEW_ORIGIN??'http://127.0.0.1:15754',width=Number(process.env.DIAL_MOVE_IN_WIDTH??1440);
// Move exercises an established workspace. A native first-owner claim starts
// unfinished, so complete the real setup protocol before clearing product data.
async function establishWorkspace(request) {
 const headers = { Origin: origin };
 async function json(path, options = {}, expected = 200) {
  const response = await request.fetch(origin + path, { ...options, headers: { ...headers, ...options.headers }, maxRedirects: 0 });
  assert.equal(response.status(), expected, `Move fixture setup: ${options.method ?? 'GET'} ${path}`);
  return response.json();
 }
 await json('/__fixtures/import-empty', { method: 'POST' });
 assert.equal((await json('/api/app/host-setup')).completedAt, null);
 await json('/api/app/profile', { method: 'PATCH', data: {
  handle: 'move-reviewer', name: 'Import reviewer', title: 'Synthetic review workspace',
  biography: 'A synthetic workspace prepared for the Move browser journey.',
  timezone: 'UTC', focusAreas: [], socialProof: [],
 } });
 assert.equal((await json('/api/app/mail/check', { method: 'POST' })).state, 'healthy');
 const event = await json('/api/app/event-types', { method: 'POST', data: {
  slug: 'setup-request', title: 'Synthetic setup request', description: 'A request-only event for completing native first run.',
  durationMinutes: 30, color: '#176b5a', locationType: 'fixed_link', locationLabel: 'Meeting',
  locationValue: 'https://meet.example.test/setup', listed: true, alternativeRequestsEnabled: true,
  slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
  beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [],
 } }, 201);
 const opened = await json(`/api/app/event-types/${event.id}/open-requests`, { method: 'POST' });
 assert.equal(opened.status, 'published');assert.equal(opened.requestOnly, true);
 const ready = await json('/api/app/host-setup');
 const link = ready.links.find(candidate => candidate.eventTypeId === event.id);
 assert.ok(link, 'Native setup exposes the current public booking link');
 await json(`/api/app/event-types/${event.id}/copy-report`, {
  method: 'POST', headers: { 'X-Dial-Copy-Report': '1' }, data: { url: link.url },
 });
 const completion = await json('/api/app/host-setup/complete', { method: 'POST' });
 assert.equal(completion.kind, 'completed');assert.ok(completion.completedAt);
 // The existing fixture clears profile/events/provider activity, preserving the
 // native session and durable completion. Move can now start with empty data.
 await json('/__fixtures/import-empty', { method: 'POST' });
 const empty = await json('/api/app/host-setup');
 assert.equal(empty.completedAt, completion.completedAt);
 assert.equal(empty.profileReady, false);assert.deepEqual(empty.links, []);
}
const browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});const errors=[],scans=[];
try{
 const context=await browser.newContext({viewport:{width,height:width===390?844:900},acceptDownloads:true});
 const bootstrap=await context.request.post(origin+'/auth/bootstrap',{data:{token:'dial-test-only-setup-token-at-least-32',displayName:'Import reviewer',returnTo:'/app'},headers:{Origin:origin},maxRedirects:0});assert.equal(bootstrap.status(),303);
 await establishWorkspace(context.request);
 const page=await context.newPage();await page.clock.install({time:new Date('2027-01-01T00:00:00.000Z')});
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin)&&!r.url().startsWith('blob:'))errors.push('External browser request');});
 async function audit(name){const report=await new AxeBuilder({page}).analyze();assert.deepEqual(report.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth));await page.screenshot({path:evidencePath(`move-in-${width}-${name}.png`),fullPage:true,caret:'initial'});scans.push({name,width,violations:report.violations});}
 const fixture=async name=>Promise.all((await readdir(`tests/move-in/fixtures/${name}`)).filter(n=>n.endsWith('.json')).map(n=>resolve(`tests/move-in/fixtures/${name}`,n)));
 async function selectFiles(name){const input=page.getByLabel('Saved response files');await expect(input).toBeEnabled();await input.setInputFiles(await fixture(name));}
 await page.goto(origin+'/app/settings#move-in');await selectFiles('solo');await page.getByRole('button',{name:'Preview saved data',exact:true}).click();await page.getByRole('button',{name:'Download JSON report'}).waitFor();await audit('preview');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON report'}).click();const file=await download;await file.saveAs(evidencePath(`move-in-${width}-report.json`));const report=JSON.parse(await readFile(evidencePath(`move-in-${width}-report.json`),'utf8'));assertReport(report);assert.equal(report.counts.bookings.imported,10);
 await page.getByLabel('I acknowledge all listed losses, rejected overlaps and changed values.').check();await page.getByRole('button',{name:'Apply reviewed import'}).click();await page.getByRole('button',{name:'Continue import'}).waitFor();await audit('progress');
 for(let n=0;n<30&&await page.getByRole('button',{name:'Continue import'}).count();n++){await page.getByRole('button',{name:'Continue import'}).click();await page.getByText('Working on this bounded batch…').waitFor({state:'hidden'});}
 await page.getByRole('button',{name:'Undo import',exact:true}).waitFor();await audit('applied');
 const status=await(await context.request.get(origin+'/__fixtures/import-status')).json();assert.equal(status.delivery_outbox.length,0);assert.equal(status.fixture_mail.length,0);assert.equal(status.fixture_events.length,0);
 // The switch-over checklist runs publication's read-only connection checks; the import itself makes no provider call.
 assert.ok(status.fixture_activity.every(row=>['check','busy','sync'].includes(row.kind)),JSON.stringify(status.fixture_activity.map(row=>row.kind)));
 await page.goto(origin+'/app');await page.getByText('10 bookings',{exact:true}).waitFor();await page.getByLabel('Latest bookings').getByText('Imported',{exact:false}).first().waitFor();await audit('overview');
 await page.goto(origin+'/app/bookings');await page.getByText('Imported',{exact:true}).first().waitFor();await page.getByText('Discuss the example project',{exact:false}).first().waitFor();await assertNativeImportedHistory({context,page,origin,report,width,audit});
 assert.equal((await context.request.post(origin+'/__fixtures/import-public')).status(),200);
 const slotResponse=await context.request.get(origin+'/api/public/book/solo/native-public/availability?week=2027-01-04&inviteeTimezone=America%2FNew_York');assert.equal(slotResponse.status(),200);const slots=await slotResponse.json();assert.equal(slots.state,'available');assert.ok(slots.slots.length>0);assert.ok(!slots.slots.some(s=>s.startAt==='2027-01-05T15:00:00.000Z'));
 await context.request.delete(origin+'/__fixtures/import-public');
 await catchUpJourney({page,context,origin,width,audit,selectFiles});
 await page.goto(origin+'/app/settings#move-in');await page.getByRole('button',{name:/completed ·/u}).first().click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Undo import',exact:true}).click();await page.getByText('Working on this bounded batch…').waitFor({state:'hidden'});
 for(let n=0;n<30&&await page.getByRole('button',{name:'Continue import'}).count();n++){await page.getByRole('button',{name:'Continue import'}).click();await page.getByText('Working on this bounded batch…').waitFor({state:'hidden'});}await audit('undone');
 assert.equal((await context.request.post(origin+'/__fixtures/import-edge-reservation')).status(),200);
 await selectFiles('edges');await page.getByRole('button',{name:'Preview saved data',exact:true}).click();await page.getByText('Overlapping confirmed Dial or earlier imported booking.',{exact:false}).first().waitFor();await audit('edge-losses');
 await page.getByLabel('Adopt source schedule timezone (leave blank to keep host zone)').fill('Europe/London');await page.getByLabel('Location value (HTTPS link, host phone or address)').first().fill('https://meet.example.test/chosen');await page.getByRole('button',{name:'Preview saved data',exact:true}).click();await page.getByText(/Host zone Europe\/London/u).waitFor();await audit('owner-choices');
 await switchOverJourney({page,context,origin,width,audit,selectFiles});
 await schedulerJourney({page,context,origin,width,audit});
 assert.deepEqual(errors,[]);await context.close();
}finally{await writeFile(evidencePath(`move-in-${width}-axe.json`),JSON.stringify({scans,errors},null,2));await browser.close();}
