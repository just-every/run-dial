import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { completeEmptyWorkspace } from '../tests/booking-axe/first-run-fixture.mjs';
const origin=process.env.DIAL_REVIEW_ORIGIN??'http://127.0.0.1:15782',folder=process.env.DIAL_GUEST_SCREENS;
assert.ok(folder,'DIAL_GUEST_SCREENS names an external evidence folder');await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']}),owner=await browser.newContext(),headers={Origin:origin},shots=[];
const json=async(response,status=200)=>{assert.equal(response.status(),status,await response.text());return response.json();};
try{
  assert.equal((await owner.request.post(origin+'/auth/bootstrap',{headers,data:{token:'dial-test-only-setup-token-at-least-32',displayName:'Synthetic Dial Owner',returnTo:'/setup'},maxRedirects:0})).status(),303);
  await completeEmptyWorkspace(owner,origin);await json(await owner.request.post(origin+'/__fixtures/setup',{headers,data:{}}));
  const event=await json(await owner.request.post(origin+'/api/app/event-types',{headers,data:{slug:'synthetic-dial-guests',title:'Consultation with guests',description:'Bring the people joining the conversation.',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Meeting room',locationValue:'https://meet.example.test/guest-room',listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:600,endMinute:1200}))}}),201);
  await json(await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`,{headers,data:{}}));
  for(const width of [1440,390]){
    const host=await owner.newPage();await host.setViewportSize({width,height:900});await host.goto(`${origin}/app/event-types/${event.id}/advanced`);await host.getByRole('button',{name:/^Guests and approval/}).click();
    const form=host.getByRole('group',{name:'Invitee guests'}),limit=form.getByLabel('Maximum guests');await limit.waitFor();if(await limit.inputValue()!=='2'){const saved=host.waitForResponse(response=>new URL(response.url()).pathname===`/api/app/event-types/${event.id}/guests`&&response.request().method()==='PUT');await limit.fill('2');await limit.blur();assert.equal((await saved).status(),200);}await host.reload();await host.getByRole('button',{name:/^Guests and approval/}).click();assert.equal(await limit.inputValue(),'2');await shot(host,width,'event-guests',form);await host.close();
    const base=`${origin}/api/public/book/dial-host/${event.slug}`,week=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
    const slot=(await json(await owner.request.get(`${base}/availability?week=${week}`))).slots[0];assert.ok(slot);
    const selection=await json(await owner.request.post(base+'/selection',{headers,data:{startAt:slot.startAt,inviteeTimezone:'UTC'}}),201);
    const context=await browser.newContext(),page=await context.newPage();await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(`${origin}/book/dial-host/${event.slug}/details?${new URLSearchParams({nonce:selection.nonce,startAt:slot.startAt,inviteeTimezone:'UTC'})}`);
      await page.getByLabel('Guest emails (optional)',{exact:true}).waitFor();await page.getByLabel('Name',{exact:true}).fill(`Synthetic Dial ${width}`);await page.getByLabel('Email',{exact:true}).fill(`synthetic-dial-${width}@example.test`);
      await page.getByLabel('Guest emails (optional)',{exact:true}).fill(`synthetic-dial-${width}-1@example.test\nsynthetic-dial-${width}-2@example.test`);await shot(page,width,'booking-guests');
      const confirmedResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/public/book/dial-host/${event.slug}/confirm`&&response.request().method()==='POST');
      await page.getByRole('button',{name:'Confirm booking',exact:true}).click();assert.equal((await confirmedResponse).status(),201);await page.waitForURL(url=>url.pathname.endsWith('/confirmed'));const token=new URL(page.url()).searchParams.get('token');assert.ok(token);const confirmed=await json(await owner.request.get(`${origin}/api/public/manage/${token}`));assert.equal(confirmed.guests.length,2);
      await page.goto(confirmed.manageUrl);const manage=page.getByRole('form',{name:'Manage guests'});await manage.getByLabel('Guest emails (optional)',{exact:true}).waitFor();await shot(page,width,'manage-guests',manage);
      await manage.getByLabel('Guest emails (optional)',{exact:true}).fill(`synthetic-dial-${width}-2@example.test`);await manage.getByRole('button',{name:'Save guests',exact:true}).click();await manage.getByRole('status').getByText('Guests updated.',{exact:false}).waitFor();await shot(page,width,'manage-guests-removed',manage);
      await json(await owner.request.post(origin+'/__fixtures/deliver',{headers,data:{}}));await json(await owner.request.post(origin+'/__fixtures/deliver',{headers,data:{}}));
      const status=await json(await owner.request.get(origin+'/__fixtures/status'));const guestMail=status.fixture_mail.map(row=>JSON.parse(row.message_json)).filter(mail=>mail.to===`synthetic-dial-${width}-1@example.test`);
      assert.equal(guestMail.filter(mail=>mail.subject.startsWith('Guest invitation cancelled:')).length,1);assert.ok(guestMail.every(mail=>!JSON.stringify(mail).includes('/manage/')));assert.deepEqual(errors,[]);
    }finally{await context.close();}
  }
  await writeFile(`${folder}/results.json`,JSON.stringify({clause:'EVENT-009',widths:[1440,390],shots,assertions:['host configures guest limit','public details submits two guests','manage removes one guest','one cancellation sent without manage capability','no serious axe findings or horizontal overflow','no page errors']},null,2));
  console.log(`EVENT-009 browser proof passed: ${shots.length} screenshots at 1440 and 390.`);
}finally{await owner.close();await browser.close();}
async function shot(page,width,name,target){await (target??page.locator('main')).scrollIntoViewIfNeeded();await page.evaluate(()=>globalThis.document.fonts.ready);const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>item.id),[]);assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.document.documentElement.clientWidth+1));await (target??page).screenshot({path:`${folder}/${name}-${width}.png`,...(!target?{fullPage:true}:{})});shots.push(`${name}-${width}.png`);}
