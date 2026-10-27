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
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--use-mock-keychain','--password-store=basic','--no-sandbox']});
  const bootstrap=await browser.newContext();
  assert.equal((await bootstrap.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'dial-test-only-setup-token-at-least-32',displayName:'Morgan Bell',returnTo:'/setup'},maxRedirects:0})).status(),303);
  await completeEmptyWorkspace(bootstrap,origin);
  assert.equal((await bootstrap.request.post(origin+'/__fixtures/setup')).status(),200);
  const storageState=await bootstrap.storageState();await bootstrap.close();
  for(const width of [1440,390]) {
    const host=await browser.newContext({storageState,viewport:{width,height:900},timezoneId:'Australia/Brisbane',permissions:['clipboard-read','clipboard-write']});
    const invitee=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Los_Angeles'});
    try {
      const page=await host.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      // Every one-off send starts from Bookings' one New menu.
      for(const [name,path] of [['New booking','/app/bookings/new'],['Meeting poll','/app/bookings?view=polls'],['Private link','/app/bookings/new/private-link']]) {
        await page.goto(origin+'/app/bookings');
        await page.locator('[data-operator-ready="true"]').waitFor();
        const trigger=page.getByRole('button',{name:'New',exact:true});
        await expect(trigger).toBeEnabled();
        await trigger.focus();await page.keyboard.press('Space');
        await expect(page.getByRole('menuitem',{name,exact:true})).toBeVisible();
        await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
        await trigger.press('Enter');
        await expect(page.getByRole('menuitem',{name:'New booking',exact:true})).toBeFocused();
        const row=['New booking','Offer specific times','Meeting poll','Private link'].indexOf(name);
        for(let index=0;index<row;index++)await page.keyboard.press('ArrowDown');
        await expect(page.getByRole('menuitem',{name,exact:true})).toBeFocused();
        await page.keyboard.press('Enter');
        await page.waitForURL(origin+path);
      }
      const privateForm=page.locator('form').filter({has:page.getByRole('button',{name:'Create link',exact:true})});
      await privateForm.getByLabel('Kind',{exact:true}).selectOption('single_use');
      await privateForm.getByLabel('Expires',{exact:true}).fill(new Date(Date.now()+4*86400000).toISOString().slice(0,16));
      const privateResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/app/booking-links'&&r.request().method()==='POST');
      await privateForm.getByRole('button',{name:'Create link',exact:true}).click();
      assert.equal((await privateResponse).status(),201);
      const privateUrl=await page.getByLabel('Private link',{exact:true}).inputValue();
      await page.getByRole('button',{name:'Copy link',exact:true}).click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),privateUrl);
      await snapshot(page,width,'private-created');
      await page.goto(origin+'/app/bookings');
      await page.locator('[data-operator-ready="true"]').waitFor();
      await page.getByRole('button',{name:'New',exact:true}).click();
      await page.getByRole('menuitem',{name:'Offer specific times',exact:true}).click();
      await page.waitForURL(origin+'/app/bookings/new/offer');
      const form=page.locator('form').filter({has:page.getByRole('button',{name:'Create link',exact:true})});
      await expect(form.getByRole('checkbox').first()).toBeEnabled({timeout:45000});
      const week=page.getByLabel('Week starting',{exact:true});
      const weekNode=await week.elementHandle();
      const weekValue=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
      const gridRead=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/availability')&&new URL(r.url()).searchParams.get('week')===weekValue&&r.request().method()==='GET');
      await week.fill(weekValue);
      assert.equal((await gridRead).status(),200);
      await expect(form.getByRole('checkbox').first()).toBeEnabled({timeout:45000});
      assert.equal(await week.evaluate((node,previous)=>node===previous,weekNode),true,'changing week reloads slots without remounting the date control');
      for(const time of [/^9-/,/^9:30-/,/^10-/])await form.getByRole('checkbox',{name:time}).first().check();
      await form.getByLabel('Link expires',{exact:true}).fill(new Date(Date.now()+4*86400000).toISOString().slice(0,16));
      assert.equal(await form.getByLabel('Hold',{exact:true}).inputValue(),'48');
      await snapshot(page,width,'selected');
      const createResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/app/booking-links'&&r.request().method()==='POST');
      await form.getByRole('button',{name:'Create link',exact:true}).click();
      const response=await createResponse;assert.equal(response.status(),201,await response.text());const created=await response.json();
      const url=await page.getByLabel('Offer link',{exact:true}).inputValue();
      await page.getByRole('button',{name:'Copy link',exact:true}).click();
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url);
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
