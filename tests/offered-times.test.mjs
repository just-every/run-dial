import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contract } from './contract.mjs';
import { fixtureVite } from './native-process/vite.mjs';
import { spawnOwned } from './native-process/lifecycle.mjs';
import { completeEmptyWorkspace } from './booking-axe/first-run-fixture.mjs';
import { evidencePath } from '../scripts/evidence-path.mjs';

contract('LINK-002','host offers held times and recipient books one at desktop and mobile widths',async t=>{
  const state=await mkdtemp(resolve(tmpdir(),'dial-offers-browser-'));
  const config=resolve('tests/booking-axe/worker.wrangler.toml'),origin='http://127.0.0.1:15752';
  const env={...process.env,CI:'1',DIAL_WRANGLER_CONFIG_PATH:config,DIAL_PERSIST_STATE_DIR:state,DIAL_INSPECTOR_PORT:'15753'};
  let server,browser,log='';
  t.after(async()=>{await browser?.close();await server?.stop();await rm(state,{recursive:true,force:true});});
  const migration=spawnOwned('pnpm',['exec','wrangler','d1','migrations','apply','dial-booking-axe-test','--local','--persist-to',state,'--config',config],{env},{label:'offers migration',onOutput:chunk=>{log+=chunk;}});
  try{await migration.waitForClose(120000);}finally{await migration.stop();}
  server=spawnOwned('pnpm',[...fixtureVite,'--host','127.0.0.1','--port','15752','--strictPort'],{env},{label:'offers runtime',onOutput:chunk=>{log+=chunk;}});
  for(let i=0;;i++) {server.assertRunning();try{if((await fetch(origin+'/health')).ok)break;}catch{ /* Native runtime is starting. */ }if(i>480)throw new Error(log.slice(-10000));await new Promise(r=>setTimeout(r,125));}
  browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  const bootstrap=await browser.newContext();
  assert.equal((await bootstrap.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'dial-test-only-setup-token-at-least-32',displayName:'Morgan Bell',returnTo:'/setup'},maxRedirects:0})).status(),303);
  await completeEmptyWorkspace(bootstrap,origin);
  assert.equal((await bootstrap.request.post(origin+'/__fixtures/setup')).status(),200);
  const storageState=await bootstrap.storageState();await bootstrap.close();
  for(const width of [1440,390]) {
    const host=await browser.newContext({storageState,viewport:{width,height:900},timezoneId:'Australia/Brisbane'});
    const invitee=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Los_Angeles'});
    try {
      const page=await host.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/app/event-types');
      const form=page.locator('form').filter({has:page.getByRole('button',{name:'Create offered-times link',exact:true})});
      await expect(form.getByRole('checkbox').first()).toBeEnabled({timeout:45000});
      await form.getByLabel('Week starting',{exact:true}).fill(new Date(Date.now()+10*86400000).toISOString().slice(0,10));
      await expect(form.getByRole('checkbox').first()).toBeEnabled({timeout:45000});
      for(const time of [/^9:00 AM/,/^9:30 AM/,/^10:00 AM/])await form.getByRole('checkbox',{name:time}).first().check();
      await form.getByLabel('Link expires (your device timezone)',{exact:true}).fill(new Date(Date.now()+4*86400000).toISOString().slice(0,16));
      assert.equal(await form.getByLabel('Hold duration (hours)',{exact:true}).inputValue(),'48');
      await snapshot(page,width,'selected');
      const createResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/app/booking-links'&&r.request().method()==='POST');
      await form.getByRole('button',{name:'Create offered-times link',exact:true}).click();
      const response=await createResponse;assert.equal(response.status(),201,await response.text());const created=await response.json();
      const url=await page.getByLabel('Offer link',{exact:true}).inputValue();
      await snapshot(page,width,'created');
      const offered=await (await host.request.get(origin+'/api/app/booking-links')).json();
      const starts=offered.find(row=>row.id===created.id).offeredStarts;
      assert.equal(starts.length,3);
      const normal=await (await host.request.get(origin+`/api/public/book/dial-host/intro/availability?week=${starts[0].slice(0,10)}`)).json();
      for(const start of starts)assert.ok(!normal.slots.some(s=>s.startAt===start));
      const guest=await invitee.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(url);
      const time=guest.locator('button[data-start-at]').first();
      await expect(time).toBeVisible();await snapshot(guest,width,'offer');await time.click();
      await expect(guest.getByLabel('Name',{exact:true})).toBeVisible();
      await guest.getByLabel('Name',{exact:true}).fill('Taylor Morgan');await guest.getByLabel('Email',{exact:true}).fill(`taylor${width}@example.test`);
      await guest.getByLabel('What would you like to discuss?',{exact:false}).fill('Planning the product workshop with our team.');
      await guest.getByRole('button',{name:'Confirm booking',exact:true}).click();
      await expect(guest.getByRole('heading',{name:/confirmed|booked/i})).toBeVisible();await snapshot(guest,width,'confirmed');
      const after=await (await host.request.get(origin+`/api/public/book/dial-host/intro/availability?week=${starts[0].slice(0,10)}`)).json();
      assert.equal(starts.filter(start=>after.slots.some(s=>s.startAt===start)).length,2);
      await guest.goto(url);await expect(guest.getByRole('heading',{name:'This link has already been used.',exact:true})).toBeVisible();await snapshot(guest,width,'used');
      assert.deepEqual(errors,[]);
    }finally{await host.close();await invitee.close();}
  }
});
async function snapshot(page,width,state) {
  assert.equal(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth),false,`${state} overflow at ${width}`);
  const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id),[],state);
  await page.screenshot({path:evidencePath(`offered-times-${width}-${state}.png`),fullPage:true});
}
